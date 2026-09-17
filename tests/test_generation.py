import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.app.database import Base
from backend.app.models import User, Course, Coursework, GeneratedAssignment
from backend.app.generation.generator_service import GeneratorService

@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()

@pytest.fixture
def test_user_and_course(db_session):
    user = User(email="student@university.edu", name="Student")
    db_session.add(user)
    db_session.commit()

    course = Course(user_id=user.id, code="CS201", name="Algorithms")
    db_session.add(course)
    db_session.commit()
    return user, course

def test_requirement_detection(db_session, test_user_and_course):
    user, course = test_user_and_course

    cw_c = Coursework(
        user_id=user.id,
        course_id=course.id,
        classroom_course_id="c1",
        coursework_id="w1",
        title="DAA LAB 4: Implement Merge Sort in C",
        description="Write MergeSort.c with gcc -Wall -Wextra"
    )
    req_c = GeneratorService.detect_assignment_requirements(cw_c)
    assert req_c["type"] == ".c"
    assert req_c["language"] == "c"

    cw_doc = Coursework(
        user_id=user.id,
        course_id=course.id,
        classroom_course_id="c1",
        coursework_id="w2",
        title="Sorting Algorithms Comprehensive Analysis Report",
        description="Prepare a report on sorting algorithms in docx format."
    )
    req_doc = GeneratorService.detect_assignment_requirements(cw_doc)
    assert req_doc["type"] == ".docx"
    assert req_doc["language"] == "document"

    cw_py = Coursework(
        user_id=user.id,
        course_id=course.id,
        classroom_course_id="c1",
        coursework_id="w3",
        title="AVL Tree Implementation in Python",
        description="Implement AVL rotations in python."
    )
    req_py = GeneratorService.detect_assignment_requirements(cw_py)
    assert req_py["type"] == ".py"
    assert req_py["language"] == "python"

def test_generate_c_assignment(db_session, test_user_and_course):
    user, course = test_user_and_course
    cw = Coursework(
        user_id=user.id,
        course_id=course.id,
        classroom_course_id="c1",
        coursework_id="w1",
        title="DAA LAB 4: Implement Merge Sort in C",
        description="Implement Merge Sort in C"
    )
    db_session.add(cw)
    db_session.commit()

    assignment = GeneratorService.generate_assignment(db_session, cw)
    assert assignment.id is not None
    assert assignment.file_type == ".c"
    assert os.path.exists(assignment.file_path)
    assert "#include <stdio.h>" in assignment.code_or_content
    assert cw.status == "GENERATED"

def test_generate_docx_assignment(db_session, test_user_and_course):
    user, course = test_user_and_course
    cw = Coursework(
        user_id=user.id,
        course_id=course.id,
        classroom_course_id="c1",
        coursework_id="w2",
        title="Sorting Report",
        description="Analysis of sorting in docx format"
    )
    db_session.add(cw)
    db_session.commit()

    assignment = GeneratorService.generate_assignment(db_session, cw)
    assert assignment.id is not None
    assert assignment.file_type == ".docx"
    assert os.path.exists(assignment.file_path)
    assert os.path.getsize(assignment.file_path) > 1000

def test_dynamic_assignment_specification(db_session, test_user_and_course):
    user, course = test_user_and_course
    cw = Coursework(
        user_id=user.id,
        course_id=course.id,
        classroom_course_id="c1",
        coursework_id="w_spec",
        title="DAA LAB 4: Implement Merge Sort in C",
        description="Write MergeSort.c using gcc -Wall -Wextra. Include test cases and benchmark CSV."
    )
    db_session.add(cw)
    db_session.commit()

    spec = GeneratorService.extract_assignment_specification(cw)
    assert spec["title"] == "DAA LAB 4: Implement Merge Sort in C"
    assert spec["course"] == "Algorithms"
    assert "MergeSort.c" in spec["required_files"]
    assert "timing_results.csv" in spec["required_files"]
    assert "Lab4_Report.docx" in spec["required_files"]
    assert "gcc -Wall -Wextra" in spec["compiler_flags"]
    assert len(spec["required_tests"]) >= 2
    assert any("Edge case" in t for t in spec["required_tests"])

def test_dynamic_languages_specification(db_session, test_user_and_course):
    user, course = test_user_and_course
    # Test C++
    cw_cpp = Coursework(
        user_id=user.id,
        course_id=course.id,
        classroom_course_id="c1",
        coursework_id="w_cpp",
        title="Matrix Multiplication in C++",
        description="Implement parallel matrix multiplication in C++"
    )
    spec_cpp = GeneratorService.extract_assignment_specification(cw_cpp)
    assert spec_cpp["language"] == "cpp"
    assert any(".cpp" in f for f in spec_cpp["required_files"])
    assert "g++" in spec_cpp["compiler_flags"]

    # Test Java
    cw_java = Coursework(
        user_id=user.id,
        course_id=course.id,
        classroom_course_id="c1",
        coursework_id="w_java",
        title="OOP Banking System in Java",
        description="Implement accounts and transactions using Java"
    )
    spec_java = GeneratorService.extract_assignment_specification(cw_java)
    assert spec_java["language"] == "java"
    assert "Main.java" in spec_java["required_files"]
    assert "javac" in spec_java["compiler_flags"]

    # Test General C (non-merge)
    cw_gen_c = Coursework(
        user_id=user.id,
        course_id=course.id,
        classroom_course_id="c1",
        coursework_id="w_genc",
        title="Producer Consumer Problem",
        description="Write solution in C using POSIX semaphores."
    )
    spec_gen_c = GeneratorService.extract_assignment_specification(cw_gen_c)
    assert spec_gen_c["language"] == "c"
    assert any(f.endswith(".c") for f in spec_gen_c["required_files"])
    assert "MergeSort.c" not in spec_gen_c["required_files"]

