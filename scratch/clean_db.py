import sqlite3
import json

def clean_database():
    conn = sqlite3.connect('academic_agent.db')
    c = conn.cursor()
    
    # 1. Clear out demo/seeded coursework
    c.execute("DELETE FROM coursework WHERE classroom_course_id LIKE 'demo-%' OR coursework_id LIKE 'demo-%' OR title LIKE 'DAA LAB 4%'")
    
    # 2. Clear out demo courses
    c.execute("DELETE FROM courses WHERE classroom_id LIKE 'demo-%' OR code IN ('CS201', 'CS202', 'MA203', 'OPERAT', 'COMPUT')")
    
    # 3. Clear fake demo classroom integrations
    c.execute("DELETE FROM classroom_integrations WHERE access_token = 'demo_google_classroom_token' OR refresh_token = 'demo_refresh_token'")
    
    # 4. Clear orphaned assignments, validations, schedules
    c.execute("DELETE FROM generated_assignments WHERE coursework_id NOT IN (SELECT id FROM coursework)")
    c.execute("DELETE FROM assignment_validations WHERE assignment_id NOT IN (SELECT id FROM generated_assignments)")
    c.execute("DELETE FROM submissions WHERE coursework_id NOT IN (SELECT id FROM coursework)")
    c.execute("DELETE FROM submission_schedules WHERE coursework_id NOT IN (SELECT id FROM coursework)")
    
    # 5. Populate user 1's timetable_entries from user 1's real cached_timetable
    row = c.execute("SELECT timetable_data FROM erp_integrations WHERE user_id = 1").fetchone()
    if row and row[0]:
        entries = json.loads(row[0])
        c.execute("DELETE FROM timetable_entries WHERE user_id = 1")
        for e in entries:
            subj = e.get('course_name') or e.get('course_code')
            c.execute("""
                INSERT INTO timetable_entries (user_id, subject, day_of_week, start_time, end_time, classroom, faculty, created_at)
                VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))
            """, (subj, e['day_of_week'], e['start_time'], e['end_time'], e.get('classroom', 'TBD'), e.get('faculty', '')))
        print(f"Populated {len(entries)} real ERP timetable entries for user 1.")

    conn.commit()
    print("Database purged and synced successfully:")
    for table in ['courses', 'coursework', 'timetable_entries', 'erp_integrations', 'classroom_integrations']:
        c.execute(f"SELECT count(*) FROM {table}")
        print(f"  {table}: {c.fetchone()[0]} rows")
    conn.close()

if __name__ == '__main__':
    clean_database()
