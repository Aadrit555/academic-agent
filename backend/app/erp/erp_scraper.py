import re
import math
import logging
from typing import Dict, List, Any, Optional
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

TIME_SLOTS = [
    ("09:00", "09:50"),
    ("10:00", "10:50"),
    ("11:00", "11:50"),
    ("12:00", "12:50"),
    ("13:00", "13:50"),
    ("14:00", "14:50"),
    ("15:00", "15:50"),
    ("16:00", "16:50"),
]

DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

def parse_subject_cell(text: str) -> Dict[str, str]:
    """
    Parses a timetable grid cell containing subject code and optional room/venue.
    Examples:
      'CSE 207 (X-201)' -> code: 'CSE 207', room: 'X-201'
      'MAT 102(C-1011)' -> code: 'MAT 102', room: 'C-1011'
      'CSE 207L (AL-02)' -> code: 'CSE 207L', room: 'AL-02'
      'ENG 101' -> code: 'ENG 101', room: ''
    """
    clean = text.strip()
    if not clean or clean.lower() in ("-", "nil", "none", "lunch", "break", "library"):
        return {"code": "", "room": ""}

    # Match code followed by optional parentheses containing room/venue
    match = re.match(r"^([A-Z]{2,4}\s*\d{2,4}[A-Z]?)(?:\s*\((.*?)\))?$", clean, re.IGNORECASE)
    if match:
        code = match.group(1).strip()
        room = match.group(2).strip() if match.group(2) else ""
        return {"code": code, "room": room}

    # Fallback: check if has parens
    if "(" in clean and ")" in clean:
        parts = clean.split("(")
        code = parts[0].strip()
        room = parts[1].replace(")", "").strip()
        return {"code": code, "room": room}

    return {"code": clean, "room": ""}

def calculate_margin(conducted: int, attended: int, current_pct: float, target_pct: float = 75.0) -> Dict[str, Any]:
    """
    Calculates the student's attendance margin against university requirement (75%).
    - If >= 75%: calculates safe bunks remaining: floor((attended - 0.75 * conducted) / 0.75)
    - If < 75%: calculates consecutive classes needed: ceil((0.75 * conducted - attended) / 0.25)
    """
    if conducted <= 0:
        return {"status": "good", "margin": 0, "message": "No classes conducted yet"}

    if current_pct >= target_pct:
        # Safe skips
        allowed_skips = int(math.floor((attended - (target_pct / 100.0) * conducted) / (target_pct / 100.0)))
        allowed_skips = max(0, allowed_skips)
        return {
            "status": "safe",
            "margin": allowed_skips,
            "can_bunk": allowed_skips,
            "classes_needed": 0,
            "message": f"Can safely miss {allowed_skips} class{'es' if allowed_skips != 1 else ''}"
        }
    else:
        # Consecutive classes needed
        needed = int(math.ceil(((target_pct / 100.0) * conducted - attended) / (1.0 - (target_pct / 100.0))))
        needed = max(1, needed)
        return {
            "status": "critical",
            "margin": -needed,
            "can_bunk": 0,
            "classes_needed": needed,
            "message": f"Must attend next {needed} consecutive class{'es' if needed != 1 else ''} to reach 75%"
        }

def normalize_time_slot(t_str: str) -> str:
    """Converts 12-hour afternoon hours (1 to 6) to 24-hour format."""
    clean = t_str.strip()
    if ":" in clean:
        parts = clean.split(":")
        try:
            h = int(parts[0])
            m = parts[1]
            if 1 <= h <= 6:
                h += 12
            return f"{h:02d}:{m}"
        except Exception:
            return clean
    return clean

class ERPScraper:
    @staticmethod
    def parse_profile(html: str) -> Dict[str, Any]:
        """Parses Student Profile from ids=1 report HTML."""
        profile: Dict[str, Any] = {
            "name": "",
            "register_no": "",
            "institution": "",
            "semester": "",
            "program": "",
            "section": "",
            "specialization": "",
            "dob": "",
            "gender": "",
            "email": "",
            "phone": ""
        }
        if not html:
            return profile

        soup = BeautifulSoup(html, "html.parser")
        for tr in soup.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) >= 2:
                key = tds[0].get_text(strip=True).lower()
                val = tds[-1].get_text(strip=True)

                if "student name" in key or (("student" in key or key == "name") and not any(p in key for p in ["father", "mother", "parent", "guardian", "contact", "advisor"])):
                    profile["name"] = val
                elif "register" in key or "reg" in key:
                    profile["register_no"] = val
                elif "institution" in key:
                    profile["institution"] = val
                elif "semester" in key:
                    profile["semester"] = val
                elif "program" in key and "section" in key:
                    parts = val.split("/")
                    profile["program"] = parts[0].strip() if len(parts) > 0 else val
                    profile["section"] = parts[1].strip() if len(parts) > 1 else ""
                elif "program" in key:
                    profile["program"] = val
                elif "section" in key:
                    profile["section"] = val
                elif "specialization" in key:
                    profile["specialization"] = val
                elif "d.o.b" in key or "dob" in key or "gender" in key:
                    if "/" in val:
                        parts = val.split("/")
                        profile["dob"] = parts[0].strip()
                        profile["gender"] = parts[1].strip()
                    elif "gender" in key:
                        profile["gender"] = val
                    else:
                        profile["dob"] = val
                elif "email" in key or "contact" in key:
                    email_match = re.search(r"[\w\.-]+@[\w\.-]+\.\w+", val)
                    if email_match:
                        profile["email"] = email_match.group(0)
                    phone_match = re.search(r"\b\d{10}\b", val)
                    if phone_match:
                        profile["phone"] = phone_match.group(0)

        return profile

    @staticmethod
    def parse_courses(html: str) -> List[Dict[str, Any]]:
        """Parses Enrolled Courses from ids=2 report HTML."""
        courses = []
        if not html:
            return courses

        soup = BeautifulSoup(html, "html.parser")
        for tr in soup.select("table tr"):
            tds = tr.find_all("td")
            if len(tds) >= 4:
                sem = tds[0].get_text(strip=True)
                code = tds[1].get_text(strip=True)
                title = tds[2].get_text(strip=True)
                credits = tds[3].get_text(strip=True)

                if code.lower() in ("course code", "code", "sub code", ""):
                    continue

                courses.append({
                    "semester": sem,
                    "code": code,
                    "name": title,
                    "credits": credits
                })
        return courses

    @staticmethod
    def parse_attendance(html: str) -> List[Dict[str, Any]]:
        """
        Parses Subject-Wise Attendance from ids=3 report HTML.
        Calculates exact attendance % and margin (skips or classes needed).
        """
        records = []
        if not html:
            return records

        soup = BeautifulSoup(html, "html.parser")
        table = soup.find("table", id="tblSubjectWiseAttendance") or soup.find("table")
        if not table:
            return records

        for tr in table.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) >= 8:
                code = tds[0].get_text(strip=True)
                name = tds[1].get_text(strip=True)
                if not code or code.lower() in ("course code", "subject code", "code", "sl.no"):
                    continue

                try:
                    conducted = int(re.sub(r"[^\d]", "", tds[2].get_text(strip=True)) or "0")
                    present = int(re.sub(r"[^\d]", "", tds[3].get_text(strip=True)) or "0")
                    absent = int(re.sub(r"[^\d]", "", tds[4].get_text(strip=True)) or "0")
                    od_ml = int(re.sub(r"[^\d]", "", tds[5].get_text(strip=True)) or "0")
                    
                    # Total percentage is in column 8 or 7
                    pct_str = tds[-1].get_text(strip=True).replace("%", "").strip()
                    pct = float(pct_str) if pct_str else round((present / conducted * 100.0) if conducted > 0 else 0.0, 1)
                except Exception:
                    conducted, present, absent, od_ml, pct = 0, 0, 0, 0, 0.0

                margin_info = calculate_margin(conducted, present, pct, target_pct=75.0)

                records.append({
                    "course_code": code,
                    "subject": name,
                    "conducted": conducted,
                    "attended": present,
                    "absent": absent,
                    "od_ml": od_ml,
                    "percentage": round(pct, 1),
                    "margin": margin_info["margin"],
                    "margin_message": margin_info["message"],
                    "status": margin_info["status"]
                })
        return records

    @staticmethod
    def parse_cgpa(html: str) -> str:
        """Parses CGPA from ids=6 report HTML."""
        if not html:
            return "0.0"
        soup = BeautifulSoup(html, "html.parser")
        match = re.search(r"CGPA\s*:\s*([\d\.]+)", soup.get_text(), re.IGNORECASE)
        if match:
            return match.group(1).strip()
        return "0.0"

    @staticmethod
    def parse_timetable(html: str) -> Dict[str, Any]:
        """
        Parses Weekly Timetable from ids=10 report HTML.
        Extracts:
          - Daily slots supporting different rooms on different days
          - Course details mapping (faculty and classroom list)
        """
        result = {
            "entries": [], # Flat list of normalized slot entries
            "courses_map": {}, # Map of code -> { name, faculty, default_room }
            "weekly_grid": {} # Map of day -> list of slots
        }
        if not html:
            return result

        soup = BeautifulSoup(html, "html.parser")
        tables = soup.find_all("table")
        if not tables:
            return result

        # First table: Weekday period grid
        grid_table = tables[0]
        # Second table (if present): Subject Details / Faculty mapping
        details_table = tables[1] if len(tables) > 1 else None

        # 1. Parse Subject Details mapping if available
        courses_map = {}
        if details_table:
            for tr in details_table.find_all("tr")[1:]:
                tds = tr.find_all(["td", "th"])
                if len(tds) >= 4:
                    code = tds[0].get_text(strip=True)
                    title = tds[1].get_text(strip=True)
                    faculty = tds[3].get_text(strip=True) if len(tds) > 3 else ""
                    rooms = tds[4].get_text(strip=True) if len(tds) > 4 else ""
                    if code and code.lower() not in ("code", "course code", "subjects description"):
                        courses_map[code] = {
                            "name": title,
                            "faculty": faculty,
                            "default_room": rooms.split(",")[0].strip() if rooms else "TBD"
                        }

        # 2. Parse Weekly Grid rows (Monday - Friday / Saturday)
        rows = grid_table.find_all("tr")
        
        # Detect active time slots from header/subheader rows
        active_slots = []
        for tr in rows:
            tds = tr.find_all(["th", "td"])
            slots_in_row = []
            for td in tds:
                txt = td.get_text(" ", strip=True)
                m = re.search(r"(\d{1,2}:\d{2})\s*(?:To|to|-|–)\s*(\d{1,2}:\d{2})", txt)
                if m:
                    s_t = normalize_time_slot(m.group(1))
                    e_t = normalize_time_slot(m.group(2))
                    slots_in_row.append((s_t, e_t))
            if len(slots_in_row) >= 4:
                active_slots = slots_in_row
                break

        if not active_slots:
            active_slots = TIME_SLOTS

        entries = []
        for tr in rows:
            tds = tr.find_all(["th", "td"])
            if not tds:
                continue

            first_col = tds[0].get_text(strip=True).lower()
            
            # Skip rows that contain time intervals or period numbers
            if re.search(r"\d{1,2}:\d{2}", first_col) or first_col in ("1", "2", "3", "4", "5", "6", "7", "8", ""):
                continue

            day_name = None
            day_idx = None
            for idx, dname in enumerate(DAYS_OF_WEEK):
                if dname.lower() in first_col or f"day {idx+1}" in first_col or f"day{idx+1}" in first_col:
                    day_name = dname
                    day_idx = idx
                    break
            
            if day_name is None:
                continue

            # Period cells
            period_cells = tds[1:]
            for slot_i, cell in enumerate(period_cells):
                if slot_i >= len(active_slots):
                    break
                cell_text = cell.get_text(strip=True)
                title_attr = cell.get("title", "").strip() if hasattr(cell, "get") else ""
                parsed = parse_subject_cell(cell_text)
                if not parsed["code"]:
                    continue

                code = parsed["code"]
                course_info = courses_map.get(code, {})
                c_name = title_attr or course_info.get("name") or code
                faculty = course_info.get("faculty") or ""
                room = parsed["room"] or course_info.get("default_room") or "TBD"

                start_t, end_t = active_slots[slot_i]

                entry = {
                    "day_of_week": day_idx,
                    "day_name": day_name,
                    "start_time": start_t,
                    "end_time": end_t,
                    "course_code": code,
                    "course_name": c_name,
                    "classroom": room,
                    "faculty": faculty
                }
                entries.append(entry)

        result["entries"] = entries
        result["courses_map"] = courses_map
        return result

