import re
from sqlalchemy.orm import Session
from backend.app.models import Document, DocumentChunk, Course
from backend.app.schemas import StudyBrainResponse, StudyCitation
from backend.app.ai.ai_service import AIService

class RAGService:
    @classmethod
    def search_chunks(cls, db: Session, course_id: int, query: str, top_k: int = 5) -> list[tuple[DocumentChunk, Document]]:
        """Finds most relevant chunks within the specified course materials."""
        query_words = set(re.findall(r"\w+", query.lower()))
        
        chunks = (
            db.query(DocumentChunk, Document)
            .join(Document, DocumentChunk.document_id == Document.id)
            .filter(DocumentChunk.course_id == course_id)
            .all()
        )

        scored = []
        for chunk, doc in chunks:
            chunk_words = set(re.findall(r"\w+", chunk.content.lower()))
            overlap = len(query_words.intersection(chunk_words))
            # Boost if query appears directly
            if query and query.lower() in chunk.content.lower():
                overlap += 5
            if overlap > 0 or not query.strip():
                scored.append((overlap, chunk, doc))

        if not scored and chunks:
            # Fallback to available chunks for this course
            return [(c, d) for c, d in chunks[:top_k]]

        scored.sort(key=lambda x: x[0], reverse=True)
        return [(c, d) for _, c, d in scored[:top_k]]

    @classmethod
    def process_study_action(
        cls, 
        db: Session, 
        course_id: int, 
        action: str, 
        query: str = "", 
        document_id: int = None,
        user: Optional[Any] = None
    ) -> StudyBrainResponse:
        course = db.query(Course).filter_by(id=course_id).first()
        course_name = course.name if course else "Course"

        # Check for ERP schedule or attendance inquiries
        erp_context_parts = []
        if user:
            from backend.app.erp.erp_service import ERPService
            q_low = (query or "").lower()
            if any(k in q_low for k in ["class", "room", "timetable", "schedule", "attendance", "bunk", "miss", "today"]):
                try:
                    next_info = ERPService.get_next_class(db, user)
                    if next_info.get("has_schedule"):
                        ongoing = next_info.get("ongoing_class")
                        upcoming = next_info.get("upcoming_class")
                        if ongoing:
                            erp_context_parts.append(f"CURRENT ONGOING CLASS: {ongoing['subject']} in {ongoing['classroom']} (Ends {ongoing['end_time']}, {ongoing['countdown']})")
                        if upcoming:
                            erp_context_parts.append(f"NEXT UPCOMING CLASS: {upcoming['subject']} in {upcoming['classroom']} at {upcoming['start_time']} ({upcoming['countdown']})")
                        
                        today_classes = next_info.get("today_classes", [])
                        if today_classes:
                            today_summary = ", ".join([f"{c['start_time']}: {c['subject']} ({c['classroom']})" for c in today_classes])
                            erp_context_parts.append(f"TODAY'S SCHEDULE: {today_summary}")

                    att_records = ERPService.get_attendance(db, user)
                    if att_records:
                        att_summary = "; ".join([
                            f"{r.get('subject', r.get('course_code'))}: {r.get('percentage')}% ({r.get('margin_message', '')})"
                            for r in att_records[:6]
                        ])
                        erp_context_parts.append(f"LIVE ATTENDANCE RECORDS: {att_summary}")
                except Exception:
                    pass

        # Fetch relevant chunks
        if document_id:
            results = (
                db.query(DocumentChunk, Document)
                .join(Document, DocumentChunk.document_id == Document.id)
                .filter(DocumentChunk.document_id == document_id)
                .limit(6)
                .all()
            )
        else:
            search_term = query if query else ""
            results = cls.search_chunks(db, course_id, search_term, top_k=6)

        citations = []
        context_parts = list(erp_context_parts)
        seen_citations = set()

        for chunk, doc in results:
            context_parts.append(f"[{doc.filename} - Page {chunk.page_number}]:\n{chunk.content}")
            cit_key = (doc.filename, chunk.page_number)
            if cit_key not in seen_citations:
                seen_citations.add(cit_key)
                citations.append(StudyCitation(
                    document_name=doc.filename,
                    page_number=chunk.page_number,
                    snippet=chunk.content[:160] + "..."
                ))

        context_text = "\n\n".join(context_parts)
        doc_name = results[0][1].filename if results else None

        if action == "summary":
            title = f"Structured Summary: {course_name}"
            if not context_text:
                content = (
                    f"### No Relevant Course Material Found for {course_name}\n\n"
                    "Study Brain could not find uploaded materials or lecture notes for this course. "
                    "Please upload the course syllabus, lecture slides, or lab manual in the Study Brain tab to generate verified course-specific summaries."
                )
            else:
                prompt = (
                    f"Summarize the following course material from {course_name} in simple, precise academic language. "
                    f"Break it down into key topics, principles, and bullet points. Mention page references where relevant.\n\n"
                    f"COURSE MATERIAL CONTEXT:\n{context_text}"
                )
                system_prompt = "You are Academic Agent Study Brain. Deliver concise, structured, high-yield academic summaries prioritizing uploaded material."
                content = AIService.generate_completion(prompt, system_prompt)

        elif action == "questions":
            title = f"High-Yield Exam Questions: {course_name}"
            if not context_text:
                content = (
                    f"### No Relevant Course Material Found for {course_name}\n\n"
                    "Study Brain requires uploaded course materials to generate authentic exam questions and model answers. "
                    "Please upload your syllabus or lecture documents to enable exam question generation."
                )
            else:
                prompt = (
                    f"Generate 10 to 15 important exam and viva questions from the following course material for {course_name}. "
                    f"For each question, provide a concise model answer and cite the source.\n\n"
                    f"COURSE MATERIAL CONTEXT:\n{context_text}"
                )
                system_prompt = "You are Academic Agent Study Brain. Generate realistic, high-yield college exam questions with model answers based directly on the provided context."
                content = AIService.generate_completion(prompt, system_prompt)

        elif action == "explanation":
            concept_name = query or "AVL Rotations and Sorting"
            title = f"In-Depth Concept Explanation: {concept_name}"
            prompt = (
                f"Explain the concept '{concept_name}' using the following uploaded material from {course_name}. "
                f"Provide clear step-by-step logic, diagrams/pseudocode where applicable, and cite sections.\n\n"
                f"COURSE MATERIAL CONTEXT:\n{context_text or 'Standard curriculum context'}"
            )
            system_prompt = "You are Academic Agent Study Brain. Explain concepts with crystal clarity using the student's own course materials as ground truth."
            content = AIService.generate_completion(prompt, system_prompt)

        elif action == "targeted_study":
            title = f"Prioritized Study Strategy: {course_name}"
            prompt = (
                f"A student asks: 'What should I study first from this material for {course_name}?'\n"
                f"Provide a prioritized study roadmap categorized into:\n"
                f"1. Immediate Core Fundamentals (Highest exam weight & prerequisites)\n"
                f"2. Algorithmic Implementations & Proofs\n"
                f"3. Common Pitfalls & Edge Cases\n"
                f"Cite uploaded document pages.\n\n"
                f"COURSE MATERIAL CONTEXT:\n{context_text or 'Standard curriculum context'}"
            )
            system_prompt = "You are Academic Agent Study Brain. Provide an actionable, high-efficiency prioritized study sequence."
            content = AIService.generate_completion(prompt, system_prompt)
        else:
            title = f"Analysis: {course_name}"
            content = "Please select an action: summary, questions, explanation, or targeted_study."

        return StudyBrainResponse(
            action=action,
            title=title,
            content=content,
            citations=citations,
            course_id=course_id,
            document_name=doc_name
        )
