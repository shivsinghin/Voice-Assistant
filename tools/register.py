import os
import importlib
from loguru import logger
from pipecat.adapters.schemas.tools_schema import ToolsSchema

def discover_tools():
    """
    Automatically discover all tool modules in the tools directory.
    Each tool module should have:
    - SCHEMA: FunctionSchema object
    - handler: async function that handles the tool call
    - FUNCTION_NAME: string with the function name
    """
    tools_dir = os.path.dirname(__file__)
    tool_modules = {}
    schemas = []
    handlers = {}
    
    # Get all Python files in the tools directory except __init__.py and register.py
    for filename in os.listdir(tools_dir):
        if filename.endswith('.py') and filename not in ['__init__.py', 'register.py']:
            module_name = filename[:-3]  # Remove .py extension
            
            try:
                # Import the module dynamically
                module = importlib.import_module(f'tools.{module_name}')
                
                # Check if module has required attributes
                if hasattr(module, 'SCHEMA') and hasattr(module, 'handler') and hasattr(module, 'FUNCTION_NAME'):
                    function_name = module.FUNCTION_NAME
                    schemas.append(module.SCHEMA)
                    handlers[function_name] = module.handler
                    tool_modules[module_name] = module
                    logger.info(f"Loaded tool: {module_name} -> {function_name}")
                    
                    # Check for additional functions (like CREATE_SCHEMA, CREATE_HANDLER)
                    if hasattr(module, 'CREATE_SCHEMA') and hasattr(module, 'CREATE_HANDLER') and hasattr(module, 'CREATE_FUNCTION_NAME'):
                        create_function_name = module.CREATE_FUNCTION_NAME
                        schemas.append(module.CREATE_SCHEMA)
                        handlers[create_function_name] = module.CREATE_HANDLER
                        logger.info(f"Loaded additional tool: {module_name} -> {create_function_name}")
                        
                else:
                    logger.warning(f"Tool module {module_name} missing required attributes (SCHEMA, handler, FUNCTION_NAME)")
                    
            except Exception as e:
                logger.error(f"Failed to load tool module {module_name}: {e}")
    
    return schemas, handlers, tool_modules

# Global variables to cache discovered tools
_schemas = None
_handlers = None
_tool_modules = None

def _ensure_tools_loaded():
    """Ensure tools are loaded and cached"""
    global _schemas, _handlers, _tool_modules
    if _schemas is None or _handlers is None or _tool_modules is None:
        _schemas, _handlers, _tool_modules = discover_tools()
    return _schemas, _handlers, _tool_modules

def get_tools_schema():
    """Return a ToolsSchema object with all discovered tools"""
    schemas, _, _ = _ensure_tools_loaded()
    return ToolsSchema(standard_tools=schemas)

def register_functions(llm_service):
    """Register all discovered function handlers with the LLM service"""
    _, handlers, _ = _ensure_tools_loaded()
    
    for function_name, handler in handlers.items():
        try:
            llm_service.register_function(function_name, handler)
            logger.info(f"Registered function: {function_name}")
        except Exception as e:
            logger.error(f"Failed to register function {function_name}: {e}")

def get_available_tools():
    """Return information about all available tools"""
    schemas, handlers, tool_modules = _ensure_tools_loaded()
    
    tools_info = {}
    for schema in schemas:
        function_name = schema.name
        tools_info[function_name] = {
            "name": function_name,
            "description": schema.description,
            "properties": schema.properties,
            "required": schema.required,
            "module": None
        }
        
        # Find which module this function belongs to
        for module_name, module in tool_modules.items():
            if hasattr(module, 'FUNCTION_NAME') and module.FUNCTION_NAME == function_name:
                tools_info[function_name]["module"] = module_name
                break
    
    return tools_info

def reload_tools():
    """Force reload all tools (useful for development)"""
    global _schemas, _handlers, _tool_modules
    _schemas = None
    _handlers = None
    _tool_modules = None
    
    # Clear import cache for tool modules
    tools_dir = os.path.dirname(__file__)
    for filename in os.listdir(tools_dir):
        if filename.endswith('.py') and filename not in ['__init__.py', 'register.py']:
            module_name = f'tools.{filename[:-3]}'
            if module_name in importlib.sys.modules:
                importlib.reload(importlib.sys.modules[module_name])
    
    # Rediscover tools
    return _ensure_tools_loaded() 