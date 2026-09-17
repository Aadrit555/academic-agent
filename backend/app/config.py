import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR / ".env")

class Settings:
    BASE_DIR: Path = BASE_DIR
    APP_NAME: str = "Academic Agent"
    APP_VERSION: str = "1.0.0"
    APP_ENV: str = os.getenv("APP_ENV", "production")
    DEBUG: bool = os.getenv("APP_DEBUG", "false").lower() in ("true", "1")
    APP_BASE_URL: str = os.getenv("APP_BASE_URL", "http://localhost:8000")
    
    # Cryptographic Secret Key for JWT & Sessions
    # In production, must be provided via SECRET_KEY environment variable.
    SECRET_KEY: str = os.getenv("SECRET_KEY", "academic-agent-default-secure-key-2026-sha256-entropy")
    
    # Custom Domain & Network Security
    CUSTOM_DOMAIN: str = os.getenv("CUSTOM_DOMAIN", "localhost")
    ALLOWED_HOSTS: list[str] = [
        h.strip() 
        for h in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") 
        if h.strip()
    ]
    CORS_ORIGINS: list[str] = [
        o.strip() 
        for o in os.getenv("CORS_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000").split(",") 
        if o.strip()
    ]
    
    # Storage directories
    UPLOAD_DIR: Path = (BASE_DIR / "uploads" / "materials").resolve()
    GENERATED_DIR: Path = (BASE_DIR / "uploads" / "generated").resolve()
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR}/academic_agent.db")
    
    # Google OAuth
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLASSROOM_CLIENT_ID", os.getenv("GOOGLE_CLIENT_ID", ""))
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLASSROOM_CLIENT_SECRET", os.getenv("GOOGLE_CLIENT_SECRET", ""))
    GOOGLE_REDIRECT_URI: str = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback")
    
    # AI Keys (Optional - offline deterministic engine used if unset)
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", os.getenv("CHATGPT_API_KEY", ""))
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", os.getenv("GOOGLE_API_KEY", ""))
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    
    # Rate Limiting
    RATE_LIMIT_ENABLED: bool = os.getenv("RATE_LIMIT_ENABLED", "true").lower() in ("true", "1")
    RATE_LIMIT_GENERAL_PER_MINUTE: int = int(os.getenv("RATE_LIMIT_GENERAL", "120"))
    RATE_LIMIT_SENSITIVE_PER_MINUTE: int = int(os.getenv("RATE_LIMIT_SENSITIVE", "20"))

    # Scheduler
    SCHEDULER_INTERVAL_SECONDS: int = int(os.getenv("SCHEDULER_INTERVAL_SECONDS", "10"))
    DEFAULT_AUTO_SUBMIT_OFFSET_HOURS: float = float(os.getenv("DEFAULT_AUTO_SUBMIT_OFFSET_HOURS", "4.0"))
    
    # Code Execution Isolation
    CODE_EXECUTION_TIMEOUT_SECONDS: int = int(os.getenv("CODE_EXECUTION_TIMEOUT_SECONDS", "8"))

    @classmethod
    def is_safe_path(cls, base_dir: Path, target_path: Path) -> bool:
        """Verifies target_path is strictly within base_dir to prevent path traversal."""
        try:
            resolved_target = target_path.resolve()
            resolved_base = base_dir.resolve()
            return resolved_base in resolved_target.parents or resolved_base == resolved_target
        except Exception:
            return False

settings = Settings()

# Ensure directories exist
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.GENERATED_DIR.mkdir(parents=True, exist_ok=True)
