import os
import json
import mimetypes
import uuid
import requests
from pathlib import Path

DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"

class DriveService:
    @classmethod
    def upload_file(cls, file_path: str, access_token: str, is_demo: bool = False) -> tuple[str, str]:
        """Uploads a local file to Google Drive. Returns (drive_file_id, file_name)."""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Generated submission file not found: {file_path}")

        file_name = os.path.basename(file_path)

        if not access_token or is_demo or access_token in ("demo_google_classroom_token", "academic_agent_google_token"):
            raise RuntimeError("A valid authenticated Google account is required to upload deliverables to Google Drive.")

        mime_type, _ = mimetypes.guess_type(file_path)
        if not mime_type:
            mime_type = "application/octet-stream"

        with open(file_path, "rb") as f:
            file_data = f.read()

        metadata = {"name": file_name, "mimeType": mime_type}
        
        # Prepare multipart/related body
        boundary = f"===============academic_agent_{uuid.uuid4().hex}==============="
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": f'multipart/related; boundary="{boundary}"',
        }

        body = (
            f"--{boundary}\r\n"
            f"Content-Type: application/json; charset=UTF-8\r\n\r\n"
            f"{json.dumps(metadata)}\r\n"
            f"--{boundary}\r\n"
            f"Content-Type: {mime_type}\r\n\r\n"
        ).encode("utf-8") + file_data + f"\r\n--{boundary}--\r\n".encode("utf-8")

        resp = requests.post(DRIVE_UPLOAD_URL, data=body, headers=headers, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        
        drive_file_id = data.get("id")
        if not drive_file_id:
            raise RuntimeError(f"Google Drive did not return file ID: {data}")
            
        return drive_file_id, file_name

    @classmethod
    def download_file(cls, file_id: str, access_token: str, default_name: str = "") -> tuple[bytes, str]:
        """Downloads a file from Google Drive.
        Handles both binary files (PDF, DOCX, TXT, code) and Google Docs/Slides (exported as PDF).
        Returns (file_bytes, file_name).
        """
        if not access_token or access_token in ("demo_google_classroom_token", "academic_agent_google_token"):
            raise RuntimeError("A valid authenticated Google account is required to download files from Google Drive.")

        headers = {"Authorization": f"Bearer {access_token}"}
        file_name = default_name or f"drive_{file_id}.pdf"

        # 1. Inspect metadata for file name and Google Workspace mimeType
        try:
            meta_resp = requests.get(
                f"https://www.googleapis.com/drive/v3/files/{file_id}?fields=id,name,mimeType",
                headers=headers,
                timeout=15
            )
            if meta_resp.status_code == 200:
                meta = meta_resp.json()
                if meta.get("name"):
                    file_name = meta.get("name")
                mime_type = meta.get("mimeType", "")

                # Handle Google Workspace documents exported to PDF
                if mime_type in (
                    "application/vnd.google-apps.document",
                    "application/vnd.google-apps.presentation",
                    "application/vnd.google-apps.spreadsheet"
                ):
                    export_url = f"https://www.googleapis.com/drive/v3/files/{file_id}/export?mimeType=application/pdf"
                    exp_resp = requests.get(export_url, headers=headers, timeout=30)
                    exp_resp.raise_for_status()
                    if not file_name.lower().endswith(".pdf"):
                        file_name += ".pdf"
                    return exp_resp.content, file_name
        except Exception:
            # Fall back to direct media download
            pass

        # 2. Direct binary download for uploaded PDFs, documents, code files
        dl_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        resp = requests.get(dl_url, headers=headers, timeout=30)
        resp.raise_for_status()

        # If file_name has no extension, attempt to guess from Content-Type or default to .pdf
        if "." not in file_name:
            ct = resp.headers.get("Content-Type", "")
            ext = mimetypes.guess_extension(ct) or ".pdf"
            file_name += ext

        return resp.content, file_name

