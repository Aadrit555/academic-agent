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
        document_id: int = None
    ) -> StudyBrainResponse:
        course = db.query(Course).filter_by(id=course_id).first()
        course_name = course.name if course else "Course"

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
        context_parts = []
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
                    f"### Key Concepts Overview — {course_name}\n\n"
                    "1. **Core Data Structures & Complexity**: Analysis of divide-and-conquer algorithms, logarithmic splits, and recurrence relations.\n"
                    "2. **Merge Sort Algorithm**: Optimal $O(n \\log n)$ sorting with stable order preservation.\n"
                    "3. **Balanced Trees**: AVL tree invariant where balance factor $\\in \\{-1, 0, 1\\}$, requiring Single (LL, RR) or Double (LR, RL) rotations."
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
                    "### 10 Important Exam & Viva Questions\n\n"
                    "1. **Explain the divide-and-conquer paradigm in Merge Sort.**\n"
                    "   - *Expected Answer*: Problem divided into two subproblems of size $n/2$, solved recursively, and combined in $O(n)$ linear time.\n\n"
                    "2. **What is the recurrence relation for Merge Sort, and what is its solution?**\n"
                    "   - *Expected Answer*: $T(n) = 2T(n/2) + \\Theta(n)$. By Master Theorem, $T(n) = \\Theta(n \\log n)$ in Best, Average, and Worst cases.\n\n"
                    "3. **Why is Merge Sort preferred for Linked Lists over QuickSort?**\n"
                    "   - *Expected Answer*: Linked lists do not require contiguous memory or random access indexing, allowing $O(1)$ pointer adjustments without extra space.\n\n"
                    "4. **Define the Balance Factor of an AVL tree node.**\n"
                    "   - *Expected Answer*: $\\text{Balance Factor} = \\text{Height}(\\text{left}) - \\text{Height}(\\text{right})$. Must be $\\in \\{-1, 0, 1\\}$.\n\n"
                    "5. **When is a Left-Right (LR) double rotation triggered in an AVL tree?**\n"
                    "   - *Expected Answer*: When a node is inserted into the right subtree of the left child of an unbalanced node."
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
