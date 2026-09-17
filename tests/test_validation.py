import os
import json
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.app.database import Base
from backend.app.models import User, Course, Coursework, GeneratedAssignment, AssignmentValidation
from backend.app.validation.validation_service import ValidationService
from backend.app.config import settings

@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()

@pytest.fixture
def setup_c_assignment(db_session):
    user = User(email="student@university.edu", name="Student")
    course = Course(user_id=1, code="CS201", name="Algorithms Lab")
    cw = Coursework(user_id=1, course_id=1, classroom_course_id="c1", coursework_id="w1", title="Merge Sort in C")
    db_session.add_all([user, course, cw])
    db_session.commit()

    code = (
        "#include <stdio.h>\n"
        "int main(void) {\n"
        "    printf(\"Merge Sort validation run successfully!\\n\");\n"
        "    return 0;\n"
        "}\n"
    )
    test_path = settings.GENERATED_DIR / "valid_test.c"
    with open(test_path, "w", encoding="utf-8") as f:
        f.write(code)

    assignment = GeneratedAssignment(
        coursework_id=cw.id,
        file_name="valid_test.c",
        file_path=str(test_path),
        file_type=".c",
        language="c",
        code_or_content=code
    )
    db_session.add(assignment)
    db_session.commit()
    db_session.refresh(assignment)
    return cw, assignment

def test_c_code_validation_success(db_session, setup_c_assignment):
    cw, assignment = setup_c_assignment

    val = ValidationService.validate_assignment(db_session, assignment)
    assert val.passed is True
    assert val.status == "PASSED"
    assert cw.status == "READY"

    checklist = json.loads(val.checklist_json)
    assert len(checklist) == 6
    assert all(item["passed"] for item in checklist)

def test_c_code_compilation_failure(db_session):
    user = User(email="student@university.edu", name="Student")
    cw = Coursework(user_id=1, classroom_course_id="c1", coursework_id="w_err", title="Broken C Program")
    db_session.add_all([user, cw])
    db_session.commit()

    broken_code = (
        "#include <stdio.h>\n"
        "int main(void) {\n"
        "    syntax_error_undefined_variable_here!!!\n"
        "    return 0;\n"
        "}\n"
    )
    test_path = settings.GENERATED_DIR / "broken_test.c"
    with open(test_path, "w", encoding="utf-8") as f:
        f.write(broken_code)

    assignment = GeneratedAssignment(
        coursework_id=cw.id,
        file_name="broken_test.c",
        file_path=str(test_path),
        file_type=".c",
        language="c",
        code_or_content=broken_code
    )
    db_session.add(assignment)
    db_session.commit()

    val = ValidationService.validate_assignment(db_session, assignment)
    assert val.passed is False
    assert val.status == "FAILED"
    assert cw.status != "READY" # Blocked from submission!
    assert "error" in val.compiler_output.lower() or "error" in val.error_details.lower()

def test_python_code_validation(db_session):
    user = User(email="student@university.edu", name="Student")
    cw = Coursework(user_id=1, classroom_course_id="c1", coursework_id="w_py", title="Python Lab")
    db_session.add_all([user, cw])
    db_session.commit()

    py_code = (
        "def solution():\n"
        "    return [x**2 for x in range(5)]\n"
        "if __name__ == '__main__':\n"
        "    print('Python test passed:', solution())\n"
    )
    test_path = settings.GENERATED_DIR / "valid_py_test.py"
    with open(test_path, "w", encoding="utf-8") as f:
        f.write(py_code)

    assignment = GeneratedAssignment(
        coursework_id=cw.id,
        file_name="valid_py_test.py",
        file_path=str(test_path),
        file_type=".py",
        language="python",
        code_or_content=py_code
    )
    db_session.add(assignment)
    db_session.commit()

    val = ValidationService.validate_assignment(db_session, assignment)
    assert val.passed is True
    assert cw.status == "READY"

