import datetime
from datetime import datetime, timedelta
import pytz
from loguru import logger
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.services.llm_service import FunctionCallParams

try:
    from googleapiclient.discovery import build
    from google.oauth2.credentials import Credentials
    GOOGLE_AVAILABLE = True
except ImportError:
    GOOGLE_AVAILABLE = False
    logger.warning("Google Calendar libraries not available. Install with: pip install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client")

# Define the calendar events fetch function schema
fetch_events_schema = FunctionSchema(
    name="fetch_calendar_events",
    description="Fetch Google Calendar events for a specific date (today, tomorrow, or specific date)",
    properties={
        "date_query": {
            "type": "string",
            "description": "Date to fetch events for: 'today', 'tomorrow', or specific date in DD-MM-YYYY or YYYY-MM-DD format",
            "default": "today"
        }
    },
    required=[]
)

# Define the calendar event creation function schema
create_event_schema = FunctionSchema(
    name="create_calendar_event",
    description="Create a new event in Google Calendar with natural language time input",
    properties={
        "summary": {
            "type": "string",
            "description": "The title/name of the event"
        },
        "start_time": {
            "type": "string",
            "description": "Start time in 12-hour format (e.g., '2:30 PM', '9:00 AM')"
        },
        "end_time": {
            "type": "string",
            "description": "End time in 12-hour format (e.g., '3:30 PM', '10:00 AM')"
        },
        "date": {
            "type": "string",
            "description": "Date for the event: 'today', 'tomorrow', or specific date in DD-MM-YYYY or YYYY-MM-DD format",
            "default": "today"
        }
    },
    required=["summary", "start_time", "end_time"]
)

def get_date_range(date_query: str):
    """Convert date query to start and end datetime objects."""
    ist = pytz.timezone('Asia/Kolkata')
    now = datetime.now(ist)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    if date_query.lower() == "today":
        start_time = today
        end_time = today + timedelta(days=1)
    elif date_query.lower() == "tomorrow":
        start_time = today + timedelta(days=1)
        end_time = today + timedelta(days=2)
    else:
        try:
            try:
                specific_date = datetime.strptime(date_query, "%Y-%m-%d")
            except ValueError:
                specific_date = datetime.strptime(date_query, "%d-%m-%Y")

            specific_date = ist.localize(specific_date)
            start_time = specific_date.replace(hour=0, minute=0, second=0, microsecond=0)
            end_time = start_time + timedelta(days=1)
        except ValueError:
            return None, None

    return start_time, end_time

def format_event_time(event_datetime) -> str:
    """Format event time in a natural, conversational way."""
    ist = pytz.timezone('Asia/Kolkata')
    if isinstance(event_datetime, str):
        event_datetime = datetime.fromisoformat(event_datetime.replace('Z', '+00:00'))

    event_datetime = event_datetime.astimezone(ist)
    hour = event_datetime.strftime("%I").lstrip("0")
    minute = event_datetime.strftime("%M")
    ampm = event_datetime.strftime("%p")

    return f"{hour}:{minute} {ampm}" if minute != "00" else f"{hour} {ampm}"

def format_date_for_speech(date_obj):
    """Format date in a natural, conversational way."""
    today = datetime.now(pytz.timezone('Asia/Kolkata')).date()
    date_obj = date_obj.date() if isinstance(date_obj, datetime) else date_obj

    if date_obj == today:
        return "today"
    elif date_obj == today + timedelta(days=1):
        return "tomorrow"
    else:
        day = date_obj.day
        suffix = "th" if 4 <= day <= 20 or 24 <= day <= 30 else ["st", "nd", "rd"][day % 10 - 1] if day % 10 in [1, 2, 3] else "th"
        return f"{day}{suffix} {date_obj.strftime('%B')}"

async def fetch_calendar_events_handler(params: FunctionCallParams):
    """Fetch Google Calendar events for a specific date."""
    if not GOOGLE_AVAILABLE:
        await params.result_callback({
            "status": "error",
            "message": "Google Calendar is not available. Please install required libraries."
        })
        return

    try:
        date_query = params.arguments.get("date_query", "today")
        
        credentials = Credentials.from_authorized_user_file('token.json', ['https://www.googleapis.com/auth/calendar.readonly'])
        service = build('calendar', 'v3', credentials=credentials)

        start_time, end_time = get_date_range(date_query)
        if not start_time or not end_time:
            await params.result_callback({
                "status": "error",
                "message": "I couldn't understand that date. You can ask about today, tomorrow, or a specific date."
            })
            return

        events_result = service.events().list(
            calendarId='primary',
            timeMin=start_time.isoformat(),
            timeMax=end_time.isoformat(),
            singleEvents=True,
            orderBy='startTime'
        ).execute()

        events = events_result.get('items', [])
        date_str = format_date_for_speech(start_time)

        if not events:
            await params.result_callback({
                "status": "success",
                "date": date_str,
                "events": [],
                "message": f"You have no events scheduled for {date_str}."
            })
            return

        formatted_events = []
        for event in events:
            summary = event.get('summary', 'Unnamed Event')
            start = event['start'].get('dateTime', event['start'].get('date'))

            if 'T' in start:
                time_str = format_event_time(start)
                formatted_events.append({
                    "summary": summary,
                    "time": time_str,
                    "is_all_day": False
                })
            else:
                formatted_events.append({
                    "summary": summary,
                    "time": "all day",
                    "is_all_day": True
                })

        await params.result_callback({
            "status": "success",
            "date": date_str,
            "events": formatted_events,
            "message": f"Here's what's scheduled for {date_str}:"
        })

    except Exception as e:
        logger.error(f"Error fetching calendar events: {e}")
        await params.result_callback({
            "status": "error",
            "message": "I'm having trouble accessing your calendar right now."
        })

async def create_calendar_event_handler(params: FunctionCallParams):
    """Create a new event in Google Calendar."""
    if not GOOGLE_AVAILABLE:
        await params.result_callback({
            "status": "error",
            "message": "Google Calendar is not available. Please install required libraries."
        })
        return

    try:
        summary = params.arguments.get("summary")
        start_time = params.arguments.get("start_time")
        end_time = params.arguments.get("end_time")
        date = params.arguments.get("date", "today")

        if not summary or not start_time or not end_time:
            await params.result_callback({
                "status": "error",
                "message": "Please provide event title, start time, and end time."
            })
            return

        credentials = Credentials.from_authorized_user_file('token.json', ['https://www.googleapis.com/auth/calendar'])
        service = build('calendar', 'v3', credentials=credentials)

        ist = pytz.timezone('Asia/Kolkata')
        now = datetime.now(ist)

        # Get the target date
        if date.lower() == "today":
            target_date = now.date()
        elif date.lower() == "tomorrow":
            target_date = (now + timedelta(days=1)).date()
        else:
            try:
                # Try parsing both date formats
                try:
                    target_date = datetime.strptime(date, "%Y-%m-%d").date()
                except ValueError:
                    target_date = datetime.strptime(date, "%d-%m-%Y").date()
            except ValueError:
                await params.result_callback({
                    "status": "error",
                    "message": "Please provide the date in YYYY-MM-DD or DD-MM-YYYY format"
                })
                return

        try:
            start_dt = datetime.strptime(start_time, "%I:%M %p").replace(
                year=target_date.year, month=target_date.month, day=target_date.day)
            end_dt = datetime.strptime(end_time, "%I:%M %p").replace(
                year=target_date.year, month=target_date.month, day=target_date.day)

            start_dt = ist.localize(start_dt)
            end_dt = ist.localize(end_dt)

            if end_dt < start_dt:
                end_dt += timedelta(days=1)
        except ValueError:
            await params.result_callback({
                "status": "error",
                "message": "Please provide the time in 12-hour format, like 2:30 PM"
            })
            return

        # Check if the event is in the past
        if start_dt < now:
            await params.result_callback({
                "status": "error",
                "message": "Sorry, I cannot schedule events in the past."
            })
            return

        event = {
            'summary': summary,
            'start': {
                'dateTime': start_dt.isoformat(),
                'timeZone': 'Asia/Kolkata',
            },
            'end': {
                'dateTime': end_dt.isoformat(),
                'timeZone': 'Asia/Kolkata',
            },
        }

        created_event = service.events().insert(calendarId='primary', body=event).execute()

        time_str = format_event_time(start_dt)
        date_str = format_date_for_speech(start_dt)
        
        await params.result_callback({
            "status": "success",
            "event_id": created_event.get('id'),
            "summary": summary,
            "start_time": time_str,
            "date": date_str,
            "message": f"I've scheduled {summary} for {time_str} {date_str}."
        })

    except Exception as e:
        logger.error(f"Error creating calendar event: {e}")
        await params.result_callback({
            "status": "error",
            "message": "I couldn't create that event. Please try again with a different time."
        })

# For the modular tools system, we need to export the schemas and handlers
# Since we have multiple functions, we'll use the fetch events as the primary one
SCHEMA = fetch_events_schema
FUNCTION_NAME = "fetch_calendar_events"

async def handler(params: FunctionCallParams):
    """Primary handler for calendar events fetching"""
    await fetch_calendar_events_handler(params)

# Additional exports for the create event function
CREATE_SCHEMA = create_event_schema
CREATE_FUNCTION_NAME = "create_calendar_event"
CREATE_HANDLER = create_calendar_event_handler 