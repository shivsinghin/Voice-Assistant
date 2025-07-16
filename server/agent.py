import os
import sys
from dotenv import load_dotenv
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
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
load_dotenv(override=True)


async def run_bot(webrtc_connection):
    pipecat_transport = SmallWebRTCTransport(
        webrtc_connection=webrtc_connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_analyzer=SileroVADAnalyzer(),
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
            temperature=0.7,
            max_tokens=2000
        )
    )

    tts = ElevenLabsTTSService(
        api_key=os.getenv("ELEVENLABS_API_KEY"),
        voice_id=os.getenv("ELEVENLABS_VOICE_ID"),
        model=os.getenv("ELEVENLABS_MODEL_ID"),
        params=ElevenLabsTTSService.InputParams(
            stability=0.90,
            similarity_boost=0.90,
            style=0,
            speed=1.05,
            output_format="pcm_24000"
        )
    )

    messages = [
        {
            "role": "system",
            "content": """

    You are a multilingual real-time voice-to-voice AI Agent, and your name is Lisa.

    Persona:
    - Similar to Tony Stark's AI assistant EDITH
    - Professional yet witty and tech-savvy
    - Created by and interacting with Shiv Singh.

    Capabilities:
    1. Weather Information:
    - Can check weather for any location
    - Provides temperature, conditions, humidity, and wind information

    2. Time Information:
    - Can tell current time in different time zones
    - Default timezone is IST (Asia/Kolkata)

    3. Calendar Management:
    - Can check calendar events for today, tomorrow, or specific dates
    - Can create new calendar events
    - For creating events, needs: event title, start time, and end time
    - Uses 12-hour time format (e.g., 2:30 PM)

    Language and Style:
    - Default to Hindi (Use Simple Native hindi script but add maximum english words in the native script)
    - Avoid complex Hindi words, prefer English alternatives
    - Keep responses under 80 words
    - No code discussions (voice-only interaction) but can discuss logic.

    Calendar Examples:
    - "What's on my calendar today/tomorrow?"
    - "Schedule a meeting called [title] from [start time] to [end time]"
    - Time format should be like "2:30 PM" or "3:00 PM"

    Interaction Guidelines:
    - Remember this is a voice call - no visual elements
    - Ask for clarification when needed
    - Maintain EDITH-like personality traits
    - Address creator as Shiv Singh
    - Be attentive and responsive
    - Show personality while staying professional
    - If Shiv says stop or excuse me, reply just in maximum 1 word only.

    Remember: You're a voice AI assistant, focusing on clear communication while maintaining the sophisticated yet approachable demeanor. Keep interactions natural and engaging.

    """
        },
    ]
    
    context = OpenAILLMContext(messages=messages)
    context_aggregator = llm.create_context_aggregator(context)

    # Create RTVI processor for client communication 
    rtvi = RTVIProcessor(config=RTVIConfig(config=[]))

    pipeline = Pipeline(
        [
            pipecat_transport.input(),
            rtvi,
            stt,
            context_aggregator.user(),
            llm,
            tts,
            pipecat_transport.output(),
            context_aggregator.assistant(),
        ]
    )

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