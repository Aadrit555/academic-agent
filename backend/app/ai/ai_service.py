import os
import json
import logging
import requests
from backend.app.config import settings

logger = logging.getLogger("academic_agent.ai")

class AIService:
    @classmethod
    def generate_completion(cls, prompt: str, system_prompt: str = "") -> str:
        """Attempts OpenAI/ChatGPT first, Gemini second, Groq third, and falls back to deterministic engine."""
        openai_key = settings.OPENAI_API_KEY
        if openai_key:
            try:
                return cls._call_openai(prompt, system_prompt, openai_key)
            except Exception as e:
                logger.warning(f"[AI] OpenAI/ChatGPT call failed: {e}. Falling back...")

        gemini_key = settings.GEMINI_API_KEY
        if gemini_key:
            try:
                return cls._call_gemini(prompt, system_prompt, gemini_key)
            except Exception as e:
                logger.warning(f"[AI] Gemini call failed: {e}. Falling back...")

        groq_key = settings.GROQ_API_KEY
        if groq_key:
            try:
                return cls._call_groq(prompt, system_prompt, groq_key)
            except Exception as e:
                logger.warning(f"[AI] Groq call failed: {e}. Falling back...")

        # No fake fallback: report AI_UNAVAILABLE honestly
        logger.warning("[AI] No configured AI provider available (OpenAI, Gemini, Groq).")
        return "[AI_UNAVAILABLE] No active AI provider key configured. Please configure an OpenAI, Gemini, or Groq API key in Settings -> AI Configuration."

    @classmethod
    def _call_openai(cls, prompt: str, system_prompt: str, api_key: str) -> str:
        url = "https://api.openai.com/v1/chat/completions"
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": "gpt-4o-mini",
            "messages": messages,
            "temperature": 0.2
        }
        resp = requests.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=30
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]

    @classmethod
    def _call_gemini(cls, prompt: str, system_prompt: str, api_key: str) -> str:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
        parts = []
        if system_prompt:
            parts.append({"text": f"SYSTEM INSTRUCTIONS:\n{system_prompt}\n\n"})
        parts.append({"text": prompt})

        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 4096}
        }
        resp = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        candidates = data.get("candidates", [])
        if candidates and "content" in candidates[0]:
            parts = candidates[0]["content"].get("parts", [])
            if parts:
                return parts[0].get("text", "")
        raise RuntimeError("Empty response from Gemini")

    @classmethod
    def _call_groq(cls, prompt: str, system_prompt: str, api_key: str) -> str:
        url = "https://api.groq.com/openai/v1/chat/completions"
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": "llama-3.3-70b-versatile",
            "messages": messages,
            "temperature": 0.2
        }
        resp = requests.post(url, json=payload, headers={"Authorization": f"Bearer {api_key}"}, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]

    @classmethod
    def _offline_completion(cls, prompt: str, system_prompt: str) -> str:
        """Simulated offline completions have been permanently removed in production."""
        return "[AI_UNAVAILABLE] No active AI provider key configured. Please configure an OpenAI, Gemini, or Groq API key in Settings -> AI Configuration."


