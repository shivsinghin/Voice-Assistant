import argparse
import asyncio
import sys
import os
from contextlib import asynccontextmanager
from typing import Dict, Optional
from datetime import datetime, timedelta
import uvicorn
from agent import run_bot
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException, Depends, status
from fastapi.responses import FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from pipecat.transports.network.webrtc_connection import IceServer, SmallWebRTCConnection
import jwt
from passlib.context import CryptContext
from pydantic import BaseModel
import requests


load_dotenv(override=True)

# JWT Configuration
SECRET_KEY = os.getenv("JWT_SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

# Password Configuration
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Admin User Configuration (from environment variables)
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
ADMIN_PASSWORD_HASH = pwd_context.hash(ADMIN_PASSWORD)

# reCAPTCHA Configuration
RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY")
RECAPTCHA_SITE_KEY = os.getenv("RECAPTCHA_SITE_KEY")
RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"

# Security
security = HTTPBearer()

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure this for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store connections by pc_id
pcs_map: Dict[str, SmallWebRTCConnection] = {}

ice_servers = [
    IceServer(urls="stun:stun.l.google.com:19302"),
    IceServer(urls="stun:stun1.l.google.com:19302"),
    IceServer(urls="stun:stun2.l.google.com:19302"),
]

# Pydantic models
class LoginRequest(BaseModel):
    username: str
    password: str
    recaptcha_token: str

class Token(BaseModel):
    access_token: str
    token_type: str

# JWT Helper Functions
def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

async def verify_recaptcha(token: str) -> bool:
    """Verify reCAPTCHA token with Google's API"""
    if not RECAPTCHA_SECRET_KEY or not RECAPTCHA_SITE_KEY:
        logger.warning("reCAPTCHA not configured, skipping verification")
        return True  # Skip verification if not configured
    
    # Allow fallback tokens when reCAPTCHA is disabled/failed on client
    if token in ['disabled', 'fallback', 'error']:
        logger.info(f"reCAPTCHA fallback token received: {token}")
        return True
    
    try:
        response = requests.post(RECAPTCHA_VERIFY_URL, data={
            'secret': RECAPTCHA_SECRET_KEY,
            'response': token
        }, timeout=10)
        
        result = response.json()
        success = result.get('success', False)
        score = result.get('score', 0)
        
        # For reCAPTCHA v3, also check the score (0.0 to 1.0, higher is better)
        if success and score >= 0.5:
            logger.info(f"reCAPTCHA verification successful, score: {score}")
            return True
        else:
            logger.warning(f"reCAPTCHA verification failed, success: {success}, score: {score}")
            return False
            
    except Exception as e:
        logger.error(f"reCAPTCHA verification error: {e}")
        return False

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None or username != ADMIN_USERNAME:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return username
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

# Authentication endpoints
@app.post("/api/login", response_model=Token)
async def login(login_request: LoginRequest):
    # Verify reCAPTCHA first
    if not await verify_recaptcha(login_request.recaptcha_token):
        logger.warning(f"reCAPTCHA verification failed for username: {login_request.username}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="reCAPTCHA verification failed. Please try again.",
        )
    
    # Verify username and password
    if login_request.username != ADMIN_USERNAME or not verify_password(login_request.password, ADMIN_PASSWORD_HASH):
        logger.warning(f"Failed login attempt for username: {login_request.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Create access token
    access_token_expires = timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    access_token = create_access_token(
        data={"sub": login_request.username}, expires_delta=access_token_expires
    )
    
    logger.info(f"Successful login for user: {login_request.username}")
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/api/verify-token")
async def verify_user_token(current_user: str = Depends(verify_token)):
    return {"valid": True, "username": current_user}

@app.get("/api/recaptcha-config")
async def get_recaptcha_config():
    """Get reCAPTCHA configuration for client"""
    return {
        "site_key": RECAPTCHA_SITE_KEY,
        "enabled": bool(RECAPTCHA_SECRET_KEY and RECAPTCHA_SITE_KEY)
    }

@app.post("/api/offer")
async def offer(request: dict, background_tasks: BackgroundTasks, current_user: str = Depends(verify_token)):
    pc_id = request.get("pc_id")

    if pc_id and pc_id in pcs_map:
        pipecat_connection = pcs_map[pc_id]
        logger.info(f"Reusing existing connection for pc_id: {pc_id} (user: {current_user})")
        await pipecat_connection.renegotiate(sdp=request["sdp"], type=request["type"])
    else:
        pipecat_connection = SmallWebRTCConnection(ice_servers)
        await pipecat_connection.initialize(sdp=request["sdp"], type=request["type"])

        @pipecat_connection.event_handler("closed")
        async def handle_disconnected(webrtc_connection: SmallWebRTCConnection):
            logger.info(f"Discarding peer connection for pc_id: {webrtc_connection.pc_id}")
            pcs_map.pop(webrtc_connection.pc_id, None)

        background_tasks.add_task(run_bot, pipecat_connection)

    answer = pipecat_connection.get_answer()
    # Updating the peer connection inside the map
    pcs_map[answer["pc_id"]] = pipecat_connection

    return answer


@app.get("/")
async def serve_index():
    return FileResponse("index.html")


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield  # Run app
    coros = [pc.disconnect() for pc in pcs_map.values()]
    await asyncio.gather(*coros)
    pcs_map.clear()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WebRTC demo")
    parser.add_argument(
        "--host", default="0.0.0.0", help="Host for HTTP server (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port", type=int, default=8000, help="Port for HTTP server (default: 8000)"
    )
    parser.add_argument("--verbose", "-v", action="count")
    args = parser.parse_args()

    logger.remove(0)
    if args.verbose:
        logger.add(sys.stderr, level="TRACE")
    else:
        logger.add(sys.stderr, level="DEBUG")

    uvicorn.run(app, host=args.host, port=args.port)
