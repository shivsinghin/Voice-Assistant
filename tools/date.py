from datetime import datetime, timedelta
import pytz
from loguru import logger
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.services.llm_service import FunctionCallParams

# Define the date calculation function schema
SCHEMA = FunctionSchema(
    name="get_date_info",
    description="Get date information, calculate dates relative to today, or get specific date details",
    properties={
        "query_type": {
            "type": "string",
            "enum": ["today", "tomorrow", "yesterday", "days_from_now", "date_format"],
            "description": "Type of date query to perform",
            "default": "today"
        },
        "days_offset": {
            "type": "integer",
            "description": "Number of days to add/subtract from today (for days_from_now query_type)",
            "default": 0
        }
    },
    required=["query_type"]
)

async def handler(params: FunctionCallParams):
    """Handle date information requests"""
    try:
        # Get current time in IST
        ist = pytz.timezone('Asia/Kolkata')
        now = datetime.now(ist)
        
        query_type = params.arguments.get("query_type", "today")
        days_offset = params.arguments.get("days_offset", 0)
        
        # Calculate target date based on query type
        if query_type == "today":
            target_date = now
        elif query_type == "tomorrow":
            target_date = now + timedelta(days=1)
        elif query_type == "yesterday":
            target_date = now + timedelta(days=-1)
        elif query_type == "days_from_now":
            target_date = now + timedelta(days=days_offset)
        else:
            target_date = now
        
        # Format the date information
        formatted_date = target_date.strftime("%B %d, %Y")
        day_name = target_date.strftime("%A")
        short_date = target_date.strftime("%d/%m/%Y")
        
        date_data = {
            "date": formatted_date,
            "day": day_name,
            "short_date": short_date,
            "query_type": query_type,
            "timezone": "IST",
            "description": f"The date is {day_name}, {formatted_date}"
        }
        
        if query_type == "days_from_now" and days_offset != 0:
            if days_offset > 0:
                date_data["description"] = f"In {days_offset} days, it will be {day_name}, {formatted_date}"
            else:
                date_data["description"] = f"{abs(days_offset)} days ago was {day_name}, {formatted_date}"
        
        await params.result_callback(date_data)
        
    except Exception as e:
        logger.error(f"Date function error: {e}")
        await params.result_callback({
            "error": "Unable to get date information. Please try again."
        })

# Export the function name for automatic registration
FUNCTION_NAME = "get_date_info" 