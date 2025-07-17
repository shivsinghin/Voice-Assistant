import random
from loguru import logger
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.services.llm_service import FunctionCallParams

# Define the weather function using Standard Schema
weather_function = FunctionSchema(
    name="get_weather",
    description="Get current weather information for any location worldwide",
    properties={
        "location": {
            "type": "string",
            "description": "The city and state/country, e.g. 'San Francisco, CA' or 'Mumbai, India'"
        },
        "unit": {
            "type": "string",
            "enum": ["celsius", "fahrenheit"],
            "description": "Temperature unit preference",
            "default": "celsius"
        }
    },
    required=["location"]
)

# Function handlers
async def get_weather_handler(params: FunctionCallParams):
    """Fake weather function that returns random weather data"""
    try:
        location = params.arguments.get("location", "Unknown Location")
        unit = params.arguments.get("unit", "celsius")
        
        # Generate fake weather data
        conditions = random.choice([
            "sunny", "partly cloudy", "cloudy", "rainy", 
            "stormy", "snowy", "foggy", "windy"
        ])
        
        if unit == "fahrenheit":
            temperature = random.randint(16, 29)  # 16-29°F
            temp_str = f"{temperature}°F"
        else:
            temperature = random.randint(0, 10)   # 0-10°C
            temp_str = f"{temperature}°C"
        
        humidity = random.randint(30, 90)
        wind_speed = random.randint(5, 25)
        
        weather_data = {
            "location": location,
            "temperature": temp_str,
            "conditions": conditions,
            "humidity": f"{humidity}%",
            "wind_speed": f"{wind_speed} km/h",
            "description": f"It's currently {conditions} in {location} with a temperature of {temp_str}"
        }
        
        await params.result_callback(weather_data)
        
    except Exception as e:
        logger.error(f"Weather function error: {e}")
        await params.result_callback({
            "error": f"Unable to get weather for {location}. Please try again."
        })

# Function registry mapping function names to their handlers
FUNCTION_HANDLERS = {
    "get_weather": get_weather_handler,
}

# List of all function schemas
ALL_FUNCTIONS = [
    weather_function,
]

def get_tools_schema():
    """Return a ToolsSchema object with all available functions"""
    return ToolsSchema(standard_tools=ALL_FUNCTIONS)

def register_functions(llm_service):
    """Register all function handlers with the LLM service"""
    for function_name, handler in FUNCTION_HANDLERS.items():
        llm_service.register_function(function_name, handler) 