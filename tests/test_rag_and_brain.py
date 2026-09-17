import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.app.database import Base
from backend.app.models import User, Course, Document, DocumentChunk
from backend.app.documents.document_service import DocumentService, chunk_text
from backend.app.rag.rag_service import RAGService

@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()

@pytest.fixture
def setup_courses(db_session):
    user = User(email="student@university.edu", name="Student")
    db_session.add(user)
    db_session.commit()

    course_ds = Course(user_id=user.id, code="CS201", name="Data Structures")
    course_algo = Course(user_id=user.id, code="CS202", name="Algorithms Lab")
    db_session.add_all([course_ds, course_algo])
    db_session.commit()
    return user, course_ds, course_algo

def test_chunking_with_overlap():
    text = (
        "Merge Sort is an asymptotically optimal divide-and-conquer comparison sorting algorithm. "
        "It divides the input array into two halves, calls itself for the two halves, and then merges "
        "the two sorted halves. The merge function is key to the algorithm. Time complexity is O(n log n). "
        "Space complexity is O(n) auxiliary memory."
    )
    chunks = chunk_text(text, chunk_size=120, overlap=30)
    assert len(chunks) >= 2
    # Ensure text was chunked into non-empty strings
    for c in chunks:
        assert len(c) > 0

def test_document_ingestion_and_course_isolation(db_session, setup_courses):
    user, course_ds, course_algo = setup_courses

    ds_content = (
        "Data Structures Lecture 7: Balanced AVL Trees and Binary Search Trees.\n\n"
        "An AVL tree maintains height balance such that balance factor is in {-1, 0, 1}. "
        "Rotations include Left-Left, Right-Right, Left-Right, and Right-Left."
    )
    algo_content = (
        "Algorithms Lab Experiment 4: Merge Sort Implementation.\n\n"
        "Divide array into subarrays and merge them. Expected deliverable is MergeSort.c."
    )

    doc_ds = DocumentService.ingest_document(db_session, user, course_ds.id, "Unit-2.txt", ds_content.encode("utf-8"))
    doc_algo = DocumentService.ingest_document(db_session, user, course_algo.id, "Lab-Manual.txt", algo_content.encode("utf-8"))

    assert doc_ds.id is not None
    assert doc_algo.id is not None

    # Search in Data Structures course should find AVL tree and NOT Merge Sort
    ds_results = RAGService.search_chunks(db_session, course_ds.id, "AVL tree balance", top_k=5)
    assert len(ds_results) > 0
    assert "AVL" in ds_results[0][0].content
    assert ds_results[0][1].course_id == course_ds.id

    # Search in Algorithms course should find Merge Sort and NOT AVL
    algo_results = RAGService.search_chunks(db_session, course_algo.id, "Merge Sort", top_k=5)
    assert len(algo_results) > 0
    assert "Merge Sort" in algo_results[0][0].content
    assert algo_results[0][1].course_id == course_algo.id

def test_study_brain_actions(db_session, setup_courses):
    user, course_ds, _ = setup_courses
    ds_content = "AVL Tree Rotations. Left-Left requires right rotation. Balance factor must remain between -1 and 1."
    DocumentService.ingest_document(db_session, user, course_ds.id, "AVL.txt", ds_content.encode("utf-8"))

    # Test summary action
    summary_res = RAGService.process_study_action(db_session, course_ds.id, "summary")
    assert summary_res.action == "summary"
    assert len(summary_res.content) > 20
    assert len(summary_res.citations) > 0

    # Test questions action
    questions_res = RAGService.process_study_action(db_session, course_ds.id, "questions")
    assert questions_res.action == "questions"
    assert len(questions_res.content) > 20

    # Test explanation action
    exp_res = RAGService.process_study_action(db_session, course_ds.id, "explanation", query="AVL Rotations")
    assert exp_res.action == "explanation"
    assert len(exp_res.content) > 20
