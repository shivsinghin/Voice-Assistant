from datetime import datetime
import pytz
from loguru import logger
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.services.llm_service import FunctionCallParams

# Define the current time function schema
SCHEMA = FunctionSchema(
    name="get_current_time",
    description="Get current date, time, and day of the week in Indian Standard Time (IST)",
    properties={},
    required=[]
)

async def handler(params: FunctionCallParams):
    """Get current date, time, and day in IST"""
    try:
        # Get current time in IST
        ist = pytz.timezone('Asia/Kolkata')
        now = datetime.now(ist)
        
        # Format the time data
        current_date = now.strftime("%B %d, %Y")  # e.g., "January 15, 2024"
        current_time = now.strftime("%I:%M %p")   # e.g., "2:30 PM"
        current_day = now.strftime("%A")          # e.g., "Monday"
        
        time_data = {
            "date": current_date,
            "time": current_time,
            "day": current_day,
            "timezone": "IST",
            "full_datetime": now.strftime("%A, %B %d, %Y at %I:%M %p IST"),
            "description": f"Today is {current_day}, {current_date}, and the current time is {current_time} IST"
        }
        
        await params.result_callback(time_data)
        
    except Exception as e:
        logger.error(f"Current time function error: {e}")
        await params.result_callback({
            "error": "Unable to get current time. Please try again."
        })

# Export the function name for automatic registration
FUNCTION_NAME = "get_current_time" 