import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

class Settings:
    APP_NAME: str = "Academic Agent"
    APP_VERSION: str = "1.0.0"
    APP_ENV: str = os.getenv("APP_ENV", "development")
    APP_BASE_URL: str = os.getenv("APP_BASE_URL", "http://localhost:8000")
    
    # Storage directories
    UPLOAD_DIR: Path = BASE_DIR / "uploads" / "materials"
    GENERATED_DIR: Path = BASE_DIR / "uploads" / "generated"
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR}/academic_agent.db")
    
    # Google OAuth
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLASSROOM_CLIENT_ID", os.getenv("GOOGLE_CLIENT_ID", ""))
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLASSROOM_CLIENT_SECRET", os.getenv("GOOGLE_CLIENT_SECRET", ""))
    GOOGLE_REDIRECT_URI: str = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback")
    
    # AI Keys
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", os.getenv("GOOGLE_API_KEY", ""))
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    
    # Scheduler
    SCHEDULER_INTERVAL_SECONDS: int = int(os.getenv("SCHEDULER_INTERVAL_SECONDS", "10"))
    DEFAULT_AUTO_SUBMIT_OFFSET_HOURS: float = float(os.getenv("DEFAULT_AUTO_SUBMIT_OFFSET_HOURS", "4.0"))
    
    # Code Execution Isolation
    CODE_EXECUTION_TIMEOUT_SECONDS: int = int(os.getenv("CODE_EXECUTION_TIMEOUT_SECONDS", "8"))

settings = Settings()

# Ensure directories exist
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.GENERATED_DIR.mkdir(parents=True, exist_ok=True)
