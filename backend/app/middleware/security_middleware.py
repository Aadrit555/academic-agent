import time
import uuid
import logging
from collections import defaultdict
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse
from backend.app.config import settings

logger = logging.getLogger("academic_agent.security")

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        # Invert/inject essential enterprise security headers
        csp = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:; "
            "connect-src 'self' https://classroom.googleapis.com https://accounts.google.com; "
            "font-src 'self' data:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self' https://accounts.google.com; "
            "frame-ancestors 'self' https://classroom.google.com https://*.google.com;"
        )
        response.headers["Content-Security-Policy"] = csp
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"

        return response


class RateLimiterMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self.request_history = defaultdict(list)

    def _get_client_ip(self, request: Request) -> str:
        # Trust X-Forwarded-For if provided, else fallback to client host
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "127.0.0.1"

    async def dispatch(self, request: Request, call_next):
        if not settings.RATE_LIMIT_ENABLED:
            return await call_next(request)

        # Skip rate limit on static assets
        path = request.url.path
        if path.startswith("/css") or path.startswith("/js") or path in ("/favicon.svg", "/favicon.ico"):
            return await call_next(request)

        client_ip = self._get_client_ip(request)
        now = time.time()
        window_seconds = 60

        # Sensitive endpoints have tighter threshold
        sensitive_paths = (
            "/api/auth/login",
            "/api/auth/register",
            "/api/assignment/generate",
            "/api/assignment/submit-now"
        )
        is_sensitive = any(path.startswith(sp) for sp in sensitive_paths)
        if client_ip in ("127.0.0.1", "::1", "localhost"):
            limit = 240
        else:
            limit = settings.RATE_LIMIT_SENSITIVE_PER_MINUTE if is_sensitive else settings.RATE_LIMIT_GENERAL_PER_MINUTE

        key = f"{client_ip}:{'sensitive' if is_sensitive else 'general'}"
        
        # Prune timestamps older than window
        timestamps = [ts for ts in self.request_history[key] if now - ts < window_seconds]
        if len(timestamps) >= limit:
            logger.warning(f"[RateLimit] Client {client_ip} exceeded limit ({limit}/min) on {path}")
            return JSONResponse(
                status_code=429,
                content={
                    "error": "Rate limit exceeded. Please wait before retrying.",
                    "limit_per_minute": limit,
                    "retry_after_seconds": 60
                },
                headers={"Retry-After": "60"}
            )

        timestamps.append(now)
        self.request_history[key] = timestamps

        return await call_next(request)

