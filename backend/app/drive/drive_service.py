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

        if is_demo or access_token == "demo_google_classroom_token":
            # Return realistic simulated Drive File ID
            simulated_id = f"1Drv-{uuid.uuid4().hex[:12]}"
            return simulated_id, file_name

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

