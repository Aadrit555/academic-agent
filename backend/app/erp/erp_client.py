import re
import logging
from typing import Optional, Tuple, Dict, Any
import httpx

logger = logging.getLogger(__name__)

BASE_PORTAL_URL = "https://student.srmap.edu.in/srmapstudentcorner"

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

class ERPClient:
    def __init__(self, base_url: str = BASE_PORTAL_URL, timeout: float = 12.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _get_client(self, jsessionid: Optional[str] = None) -> httpx.Client:
        cookies = {}
        if jsessionid:
            cookies["JSESSIONID"] = jsessionid
        return httpx.Client(
            headers=BROWSER_HEADERS,
            cookies=cookies,
            timeout=self.timeout,
            verify=False,
            follow_redirects=True
        )

    def initiate_session(self) -> Tuple[bool, str, Optional[str]]:
        """
        Loads the SRM AP login page and captures the initial JSESSIONID.
        Returns (success, jsessionid, error_message).
        """
        url = f"{self.base_url}/StudentLoginPage"
        try:
            with httpx.Client(headers=BROWSER_HEADERS, timeout=self.timeout, verify=False) as client:
                resp = client.get(url)
                if resp.status_code != 200:
                    return False, "", f"SRM AP Portal returned HTTP {resp.status_code}"
                
                # Check cookies
                jsessionid = client.cookies.get("JSESSIONID")
                if not jsessionid:
                    # Try parsing Set-Cookie header manually
                    set_cookie = resp.headers.get("set-cookie", "")
                    match = re.search(r"JSESSIONID=([^;]+)", set_cookie)
                    if match:
                        jsessionid = match.group(1)
                
                if not jsessionid:
                    return False, "", "Could not obtain JSESSIONID from SRM AP portal"
                
                return True, jsessionid, None
        except Exception as e:
            logger.error(f"Failed to reach SRM AP portal at {url}: {e}")
            return False, "", f"SRM AP portal unreachable: {str(e)}"

    def get_captcha_image(self, jsessionid: str) -> Optional[bytes]:
        """Fetches the captcha challenge image using the current session."""
        url = f"{self.base_url}/captchas"
        headers = {
            **BROWSER_HEADERS,
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Referer": f"{self.base_url}/StudentLoginPage",
            "Cookie": f"JSESSIONID={jsessionid}"
        }
        try:
            with httpx.Client(headers=headers, timeout=self.timeout, verify=False) as client:
                resp = client.get(url)
                if resp.status_code == 200 and len(resp.content) > 100:
                    return resp.content
                return None
        except Exception as e:
            logger.error(f"Failed to fetch captcha from {url}: {e}")
            return None

    def login_attempt(self, username: str, password: str, captcha_code: str, jsessionid: str) -> Tuple[bool, str, str]:
        """
        Submits login credentials and solved captcha to SRM AP.
        Returns: (success, student_name_or_message, jsessionid)
        """
        url = f"{self.base_url}/StudentLoginToPortal"
        headers = {
            **BROWSER_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://student.srmap.edu.in",
            "Referer": f"{self.base_url}/StudentLoginPage",
            "Cookie": f"JSESSIONID={jsessionid}"
        }
        data = {
            "txtUserName": username.strip().upper(),
            "txtAuthKey": password,
            "ccode": captcha_code.strip().upper(),
        }
        try:
            with httpx.Client(headers=headers, timeout=self.timeout, verify=False, follow_redirects=True) as client:
                resp = client.post(url, data=data)
                html = resp.text

                # Check for divmsg error in failure page
                if "divmsg" in html:
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(html, "html.parser")
                    divmsg = soup.find(id="divmsg")
                    msg = divmsg.text.strip() if divmsg else ""
                    if msg:
                        return False, msg, jsessionid

                # Check for successful login indicators
                # Srmap-Api checks: h2 tag or dashboard components
                name_match = re.search(r"<h2>(.*?)</h2>", html, re.IGNORECASE)
                if name_match:
                    student_name = name_match.group(1).strip()
                    # Clean up prefix e.g. "Welcome to..."
                    if "welcome" in student_name.lower():
                        student_name = re.sub(r"(?i)welcome\s+(to\s+)?", "", student_name).strip()
                    return True, student_name or "Student", jsessionid

                if "HRDSystem" in resp.text or "studentreportresources" in resp.text or "logout" in resp.text.lower():
                    return True, "Student", jsessionid

                # If redirected to HRDSystem or dashboard
                if "/HRDSystem" in str(resp.url):
                    return True, "Student", jsessionid

                return False, "Invalid Registration Number or Password", jsessionid
        except Exception as e:
            logger.error(f"Error submitting login to {url}: {e}")
            return False, f"Connection error: {str(e)}", jsessionid

    def fetch_report_html(self, jsessionid: str, report_id: str) -> Optional[str]:
        """
        Fetches student report fragments from studentreportresources.jsp.
        ids=1: Student Profile
        ids=2: Registered Courses
        ids=3: Attendance Records
        ids=6: CGPA & Grades
        ids=10: Weekly Timetable
        """
        url = f"{self.base_url}/students/report/studentreportresources.jsp"
        headers = {
            **BROWSER_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": f"{self.base_url}/HRDSystem",
            "Cookie": f"JSESSIONID={jsessionid}"
        }
        data = {"ids": str(report_id)}
        try:
            with httpx.Client(headers=headers, timeout=self.timeout, verify=False) as client:
                resp = client.post(url, data=data)
                if resp.status_code == 200:
                    return resp.text
                return None
        except Exception as e:
            logger.error(f"Failed to fetch report {report_id} from {url}: {e}")
            return None

    def fetch_hrd_system_html(self, jsessionid: str) -> Optional[str]:
        """Fetches HRDSystem main dashboard."""
        url = f"{self.base_url}/HRDSystem"
        headers = {
            **BROWSER_HEADERS,
            "Referer": f"{self.base_url}/StudentLoginToPortal",
            "Cookie": f"JSESSIONID={jsessionid}"
        }
        try:
            with httpx.Client(headers=headers, timeout=self.timeout, verify=False) as client:
                resp = client.post(url)
                if resp.status_code == 200:
                    return resp.text
                return None
        except Exception as e:
            logger.error(f"Failed to fetch HRDSystem: {e}")
            return None

