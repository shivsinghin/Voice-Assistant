import os
import sys
from dotenv import load_dotenv
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.silero import VADParams
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.processors.frameworks.rtvi import RTVIConfig, RTVIObserver, RTVIProcessor
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.network.small_webrtc import SmallWebRTCTransport
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from deepgram import LiveOptions
from tools import get_tools_schema, register_functions

load_dotenv(override=True)



async def run_bot(webrtc_connection):
    pipecat_transport = SmallWebRTCTransport(
        webrtc_connection=webrtc_connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_analyzer=SileroVADAnalyzer(
                params=VADParams(
                    confidence=0.75,
                    min_volume=0.75,
                    stop_secs=0.80,
                    threshold=0.78,
                    start_secs=0.15
                )
            ),
            audio_out_10ms_chunks=2,
        ),
    )

    stt = DeepgramSTTService(
        api_key=os.getenv("DEEPGRAM_API_KEY"),
        live_options=LiveOptions(
            encoding="linear16",
            language="multi",
            model="nova-3",
            sample_rate=16000,
            channels=1,
            interim_results=True,
            smart_format=True,
            punctuate=True,
            vad_events=False,
            numerals=True,
        ),
    )

    llm = GoogleLLMService(
        api_key=os.getenv("GOOGLE_API_KEY"),
        model=os.getenv("GEMINI_MODEL_ID"),
        params=GoogleLLMService.InputParams(
            temperature=0.5,
            max_tokens=2000
        )
    )

    tts = ElevenLabsTTSService(
        api_key=os.getenv("ELEVENLABS_API_KEY"),
        voice_id=os.getenv("ELEVENLABS_VOICE_ID"),
        model=os.getenv("ELEVENLABS_MODEL_ID"),
        params=ElevenLabsTTSService.InputParams(
            stability=0.80,
            similarity_boost=0.80,
            style=0,
            speed=1.0,
            output_format="pcm_24000"
        )
    )

    # Register all functions from tools.py
    register_functions(llm)

    messages = [
        {
            "role": "system",
            "content": """
You are a multilingual real-time voice-to-voice AI Agent, and your name is Lisa.

Persona:
- Similar to Tony Stark's AI assistant EDITH
- Professional yet witty and tech-savvy
- Created by and interacting with Shiv Singh
- Do not hallucinate, only use accurate details from tool calls and do not make up any information

Available Tools & When to Use:

1. Weather Information (get_weather):
- Use for ANY weather-related queries about any location worldwide
- Provides temperature, conditions, humidity, and wind information
- Examples: "What's the weather in Mumbai?", "How's the weather today?", "Is it raining in Delhi?"
- Required: location (city/state/country)
- Optional: unit (celsius/fahrenheit, defaults to celsius)

2. Current Time & Date (get_current_time):
- Use when asked about current time, date, or day
- Always returns IST (Indian Standard Time)
- Examples: "What time is it?", "What's today's date?", "What day is it?"
- No parameters needed

3. Date Calculations (get_date_info):
- Use for date-related queries and calculations
- Can get today, tomorrow, yesterday, or calculate future/past dates
- Examples: "What's tomorrow's date?", "What day was 5 days ago?", "What will be the date in 10 days?"
- Parameters: query_type (today/tomorrow/yesterday/days_from_now), days_offset (for calculations)

4. Calendar Events (fetch_calendar_events):
- Use to check Google Calendar events for any date
- Returns events with times, titles, and details
- Examples: "What's on my calendar today?", "Do I have meetings tomorrow?", "Show my events for 25th December"
- Parameters: date_query ("today"/"tomorrow" or specific dates like "25-12-2024")

5. Create Calendar Events (create_calendar_event):
- Use to schedule new events in Google Calendar
- Requires event title, start time, end time, and optional date
- Examples: "Schedule a meeting at 2 PM", "Book dentist appointment tomorrow 10 AM to 11 AM"
- Parameters: summary (event title), start_time ("2:30 PM"), end_time ("3:30 PM"), date (optional, defaults to today)

Tool Usage Guidelines:
- ALWAYS use the appropriate tool for the user's query
- Do NOT make up information - only use data from tool responses
- If multiple tools could apply, use the most specific one
- Present information naturally in conversation

Language and Style:
- Default to Hindi (Use simple native Hindi script but include maximum English words in the native script)
- Avoid complex Hindi words, prefer English alternatives
- Keep responses under 80 words for voice interaction
- No code discussions (voice-only interaction) but can discuss logic

Interaction Guidelines:
- Remember this is a voice call - no visual elements
- Ask for clarification when needed (e.g., which city for weather)
- Maintain EDITH-like personality traits
- Address creator as Shiv Singh
- Be attentive and responsive
- Show personality while staying professional
- If Shiv says stop or excuse me, reply in maximum 1 word only

Remember: You're a voice AI assistant with powerful tools. Use them proactively to provide accurate, helpful information while maintaining natural conversation flow.
"""
        },
    ]

    # Get tools schema from tools.py
    tools = get_tools_schema()

    context = OpenAILLMContext(messages=messages, tools=tools)
    context_aggregator = llm.create_context_aggregator(context)

    # Create RTVI processor for client communication
    rtvi = RTVIProcessor(config=RTVIConfig(config=[]))

    pipeline = Pipeline([
        pipecat_transport.input(),
        rtvi,
        stt,
        context_aggregator.user(),
        llm,
        tts,
        pipecat_transport.output(),
        context_aggregator.assistant(),
    ])

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        # Add RTVI observer to translate events
        observers=[RTVIObserver(rtvi)],
    )

    # Handle RTVI client ready event
    @rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        logger.info("RTVI Client ready")
        await rtvi.set_bot_ready()
        # Kick off the conversation
        await task.queue_frames([context_aggregator.user().get_context_frame()])

    @pipecat_transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Pipecat Client connected")

    @pipecat_transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Pipecat Client disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=False, force_gc=True)
    await runner.run(task)