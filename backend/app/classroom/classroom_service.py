import requests
from datetime import datetime, date, timedelta, timezone
from sqlalchemy.orm import Session
from backend.app.models import User, Course, Coursework, ClassroomIntegration
from backend.app.auth.auth_service import AuthService

API_BASE = "https://classroom.googleapis.com/v1"

def utcnow():
    return datetime.now(timezone.utc)

class ClassroomService:
    @classmethod
    def sync_classroom_data(cls, db: Session, user: User) -> list[Coursework]:
        token, is_demo = AuthService.get_valid_token(db, user)
        if not token:
            raise RuntimeError("Google Classroom is not connected. Please connect via OAuth or Demo Mode.")

        if is_demo:
            return cls._sync_demo_data(db, user)
        else:
            return cls._sync_live_data(db, user, token)

    @classmethod
    def _sync_live_data(cls, db: Session, user: User, token: str) -> list[Coursework]:
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        # 1. Fetch courses
        cr = requests.get(f"{API_BASE}/courses", headers=headers, params={"courseStates": "ACTIVE", "pageSize": 50}, timeout=20)
        cr.raise_for_status()
        courses_data = cr.json().get("courses", [])

        synced_coursework = []
        for c in courses_data:
            cid = c.get("id")
            cname = c.get("name") or "Course"
            
            # Find or create local Course
            course = db.query(Course).filter_by(user_id=user.id, classroom_id=cid).first()
            if not course:
                course = Course(
                    user_id=user.id,
                    code=c.get("section") or cid[:6].upper(),
                    name=cname,
                    instructor="",
                    classroom_id=cid
                )
                db.add(course)
                db.commit()
                db.refresh(course)

            # 2. Fetch coursework for this course
            wr = requests.get(f"{API_BASE}/courses/{cid}/courseWork", headers=headers, params={"pageSize": 50}, timeout=20)
            if wr.status_code != 200:
                continue
            works = wr.json().get("courseWork", [])

            for w in works:
                wid = w.get("id")
                title = w.get("title", "Assignment")
                desc = w.get("description", "")
                pts = float(w.get("maxPoints") or 100.0)
                link = w.get("alternateLink", "")

                # Due date / time
                due_obj = w.get("dueDate") or {}
                due_date_str = None
                if due_obj.get("year") and due_obj.get("month") and due_obj.get("day"):
                    due_date_str = f"{due_obj['year']:04d}-{due_obj['month']:02d}-{due_obj['day']:02d}"

                time_obj = w.get("dueTime") or {}
                due_time_str = None
                if time_obj.get("hours") is not None:
                    h = time_obj.get("hours", 23)
                    m = time_obj.get("minutes", 59)
                    due_time_str = f"{h:02d}:{m:02d}:00"

                # Check student submissions
                sub_id = ""
                sub_state = "NOT_STARTED"
                try:
                    sr = requests.get(f"{API_BASE}/courses/{cid}/courseWork/{wid}/studentSubmissions", 
                                      headers=headers, params={"userId": "me"}, timeout=15)
                    if sr.status_code == 200:
                        subs = sr.json().get("studentSubmissions", [])
                        if subs:
                            sub_id = subs[0].get("id", "")
                            if subs[0].get("state") == "TURNED_IN":
                                sub_state = "SUBMITTED"
                except Exception:
                    pass

                cw = db.query(Coursework).filter_by(user_id=user.id, coursework_id=wid).first()
                if not cw:
                    cw = Coursework(
                        user_id=user.id,
                        course_id=course.id,
                        classroom_course_id=cid,
                        coursework_id=wid,
                        title=title,
                        description=desc,
                        due_date=due_date_str,
                        due_time=due_time_str,
                        max_points=pts,
                        alternate_link=link,
                        submission_id=sub_id,
                        status=sub_state
                    )
                    db.add(cw)
                else:
                    cw.title = title
                    cw.description = desc
                    cw.due_date = due_date_str
                    cw.due_time = due_time_str
                    cw.submission_id = sub_id
                    if cw.status == "NOT_STARTED" and sub_state == "SUBMITTED":
                        cw.status = "SUBMITTED"
                db.commit()
                db.refresh(cw)
                synced_coursework.append(cw)

        # Update last synced time
        integ = db.query(ClassroomIntegration).filter_by(user_id=user.id).first()
        if integ:
            integ.last_synced_at = utcnow()
            db.commit()

        return synced_coursework

    @classmethod
    def _sync_demo_data(cls, db: Session, user: User) -> list[Coursework]:
        """Seeds realistic university courses & coursework for instant interactive evaluation."""
        demo_courses = [
            {"code": "CS201", "name": "Data Structures", "instructor": "Dr. Sarah Mitchell", "color": "#4f46e5", "cid": "demo-ds-101"},
            {"code": "CS202", "name": "Algorithms Lab", "instructor": "Prof. Alan Vance", "color": "#059669", "cid": "demo-algo-102"},
            {"code": "MA203", "name": "Discrete Mathematics", "instructor": "Dr. Elena Rostova", "color": "#d97706", "cid": "demo-math-103"},
        ]
        
        course_map = {}
        for dc in demo_courses:
            course = db.query(Course).filter_by(user_id=user.id, classroom_id=dc["cid"]).first()
            if not course:
                course = Course(
                    user_id=user.id,
                    code=dc["code"],
                    name=dc["name"],
                    instructor=dc["instructor"],
                    color=dc["color"],
                    classroom_id=dc["cid"]
                )
                db.add(course)
                db.commit()
                db.refresh(course)
            course_map[dc["cid"]] = course

        # Set realistic relative dates (e.g. tomorrow, 3 days from now, next week)
        now = utcnow()
        tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")
        in_3_days = (now + timedelta(days=3)).strftime("%Y-%m-%d")
        in_7_days = (now + timedelta(days=7)).strftime("%Y-%m-%d")

        demo_assignments = [
            {
                "cid": "demo-algo-102",
                "wid": "demo-cw-merge-sort",
                "title": "DAA LAB 4: Implement Merge Sort in C",
                "description": (
                    "Objective: Implement the Merge Sort divide-and-conquer algorithm in C.\n"
                    "Requirements:\n"
                    "- Expected Deliverable: MergeSort.c\n"
                    "- Define merge() and mergeSort() functions.\n"
                    "- Accept array inputs from standard input or benchmark test array.\n"
                    "- Display sorted array output and time complexity analysis.\n"
                    "- Code must compile cleanly with gcc -Wall -Wextra with zero warnings."
                ),
                "due_date": tomorrow,
                "due_time": "23:59:00",
                "max_points": 100.0,
                "status": "NOT_STARTED",
                "sub_id": "demo-sub-merge-sort"
            },
            {
                "cid": "demo-ds-101",
                "wid": "demo-cw-sorting-report",
                "title": "Sorting Algorithms Comprehensive Analysis Report",
                "description": (
                    "Objective: Prepare a structured comparative study of QuickSort, MergeSort, and HeapSort.\n"
                    "Requirements:\n"
                    "- Expected Deliverable: sorting_report.docx\n"
                    "- Required Sections: Introduction, Algorithm Analysis, Big-O Complexity Table, Tradeoffs, Conclusion.\n"
                    "- Format: Professional document layout with headings, paragraphs, and formatted comparisons."
                ),
                "due_date": in_3_days,
                "due_time": "23:59:00",
                "max_points": 50.0,
                "status": "NOT_STARTED",
                "sub_id": "demo-sub-sorting-report"
            },
            {
                "cid": "demo-ds-101",
                "wid": "demo-cw-avl-tree",
                "title": "Assignment 3: Implement AVL Tree Rotations in Python",
                "description": (
                    "Objective: Implement self-balancing Binary Search Tree (AVL Tree) in Python.\n"
                    "Requirements:\n"
                    "- Expected Deliverable: avl_tree.py\n"
                    "- Implement left_rotate, right_rotate, insert, and balance factor computation.\n"
                    "- Include verification unit tests."
                ),
                "due_date": in_7_days,
                "due_time": "23:59:00",
                "max_points": 100.0,
                "status": "NOT_STARTED",
                "sub_id": "demo-sub-avl"
            }
        ]

        synced_coursework = []
        for da in demo_assignments:
            course = course_map[da["cid"]]
            cw = db.query(Coursework).filter_by(user_id=user.id, coursework_id=da["wid"]).first()
            if not cw:
                cw = Coursework(
                    user_id=user.id,
                    course_id=course.id,
                    classroom_course_id=da["cid"],
                    coursework_id=da["wid"],
                    title=da["title"],
                    description=da["description"],
                    due_date=da["due_date"],
                    due_time=da["due_time"],
                    max_points=da["max_points"],
                    alternate_link=f"https://classroom.google.com/c/{da['cid']}/a/{da['wid']}/details",
                    submission_id=da["sub_id"],
                    status=da["status"]
                )
                db.add(cw)
                db.commit()
                db.refresh(cw)
            synced_coursework.append(cw)

        integ = db.query(ClassroomIntegration).filter_by(user_id=user.id).first()
        if integ:
            integ.last_synced_at = utcnow()
            db.commit()

        return synced_coursework

