from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from backend.app.config import settings

# SQLite requires check_same_thread=False for multithreaded FastAPI requests
connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    # Import all models to ensure they are registered with Base
    from sqlalchemy import inspect, text
    import backend.app.models
    Base.metadata.create_all(bind=engine)

    # Auto-migrate SQLite columns for backward compatibility
    with engine.connect() as conn:
        inspector = inspect(engine)
        if "users" in inspector.get_table_names():
            columns = [col["name"] for col in inspector.get_columns("users")]
            if "hashed_password" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN hashed_password VARCHAR(255)"))
            if "salt" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN salt VARCHAR(64)"))
            if "role" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(32) DEFAULT 'student'"))
            if "is_active" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1"))
        
        if "timetable_entries" in inspector.get_table_names():
            tt_cols = [col["name"] for col in inspector.get_columns("timetable_entries")]
            if "faculty" not in tt_cols:
                conn.execute(text("ALTER TABLE timetable_entries ADD COLUMN faculty VARCHAR(255) DEFAULT ''"))

        if "erp_integrations" in inspector.get_table_names():
            erp_cols = [col["name"] for col in inspector.get_columns("erp_integrations")]
            if "encrypted_password" not in erp_cols:
                conn.execute(text("ALTER TABLE erp_integrations ADD COLUMN encrypted_password TEXT DEFAULT ''"))
            if "profile_data" not in erp_cols:
                conn.execute(text("ALTER TABLE erp_integrations ADD COLUMN profile_data TEXT DEFAULT '{}'"))
            if "timetable_data" not in erp_cols:
                conn.execute(text("ALTER TABLE erp_integrations ADD COLUMN timetable_data TEXT DEFAULT '[]'"))

        if "coursework" in inspector.get_table_names():
            cw_cols = [col["name"] for col in inspector.get_columns("coursework")]
            if "materials_json" not in cw_cols:
                conn.execute(text("ALTER TABLE coursework ADD COLUMN materials_json TEXT DEFAULT '[]'"))

        if "generated_assignments" in inspector.get_table_names():
            ga_cols = [col["name"] for col in inspector.get_columns("generated_assignments")]
            if "report_file_name" not in ga_cols:
                conn.execute(text("ALTER TABLE generated_assignments ADD COLUMN report_file_name VARCHAR(255) DEFAULT ''"))
            if "report_file_path" not in ga_cols:
                conn.execute(text("ALTER TABLE generated_assignments ADD COLUMN report_file_path VARCHAR(500) DEFAULT ''"))
            if "report_content" not in ga_cols:
                conn.execute(text("ALTER TABLE generated_assignments ADD COLUMN report_content TEXT DEFAULT ''"))
        
        conn.commit()

