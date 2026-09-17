// 12-Step Interactive Expo Demonstration Module
const ExpoDemoModule = {
  currentStep: 0,
  timer: null,
  isPaused: false,
  totalSteps: 12,

  steps: [
    {
      num: 1,
      title: "Step 1: Connect Google Classroom",
      desc: "Connecting authorized Google Classroom environment and retrieving courses & coursework...",
      async execute() {
        await api("/demo/setup", { method: "POST" });
        await checkAuthStatus();
        navigateTo("classroom");
        await ClassroomModule.loadClassroom();
      }
    },
    {
      num: 2,
      title: "Step 2: Import Academic Timetable",
      desc: "Importing class schedule entries with subjects, days, times, and classrooms...",
      async execute() {
        navigateTo("timetable");
        await TimetableModule.loadTimetable();
      }
    },
    {
      num: 3,
      title: "Step 3: Upload Course Materials",
      desc: "Course documents (Unit-2.pdf and Lab-Manual.pdf) ingested and indexed by course...",
      async execute() {
        navigateTo("study-brain");
        await StudyBrainModule.loadStudyBrain();
      }
    },
    {
      num: 4,
      title: "Step 4: Classroom Assignment Detected",
      desc: "Classroom assignment detected: 'DAA LAB 4: Implement Merge Sort in C' (Due Tomorrow)...",
      async execute() {
        navigateTo("classroom");
        await ClassroomModule.loadClassroom();
      }
    },
    {
      num: 5,
      title: "Step 5: Click Generate Assignment",
      desc: "Reading assignment instructions, pulling Unit-2 & Lab Manual context, and generating MergeSort.c...",
      async execute() {
        navigateTo("generator");
        await GeneratorModule.loadGenerator();
        // Select DAA Lab 4 if available
        const daa = AppState.coursework.find(c => c.title.includes("Merge Sort"));
        if (daa) GeneratorModule.selectAssignment(daa.id);
        await GeneratorModule.triggerGeneration();
      }
    },
    {
      num: 6,
      title: "Step 6: Code Validation Pipeline",
      desc: "Reading ✓ Generating ✓ Compiling with MinGW gcc -Wall -Wextra ✓ Testing ✓ Ready for Submission ✓",
      async execute() {
        const daa = AppState.coursework.find(c => c.title.includes("Merge Sort"));
        if (daa) await ValidationModule.runValidation(daa.id);
      }
    },
    {
      num: 7,
      title: "Step 7: Enable Auto-Submit (4 Hours Before Deadline)",
      desc: "Enabling automated turn-in scheduled for 4 hours before the assignment deadline...",
      async execute() {
        const daa = AppState.coursework.find(c => c.title.includes("Merge Sort"));
        if (daa) {
          await api(`/assignment/${daa.id}/schedule`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ coursework_id: daa.id, offset_hours: 4.0, auto_submit_enabled: true })
          });
        }
      }
    },
    {
      num: 8,
      title: "Step 8: Auto-Submission Scheduled",
      desc: "Schedule stored persistently in background engine: Submitting 4 hours prior to deadline...",
      async execute() {
        navigateTo("schedules");
        await SchedulerModule.loadSchedules();
      }
    },
    {
      num: 9,
      title: "Step 9: Ask Study Brain: Summarize Unit 2",
      desc: "Study Brain synthesizes structured summary from uploaded Unit-2.pdf with source page citations...",
      async execute() {
        navigateTo("study-brain");
        await StudyBrainModule.loadStudyBrain();
        await StudyBrainModule.runAction("summary");
      }
    },
    {
      num: 10,
      title: "Step 10: Ask Study Brain: Generate 10 Questions",
      desc: "Generating high-yield exam & viva questions directly from course notes...",
      async execute() {
        navigateTo("study-brain");
        await StudyBrainModule.runAction("questions");
      }
    },
    {
      num: 11,
      title: "Step 11: Display NEXT CLASS Context",
      desc: "Academic Agent contextual awareness: NEXT CLASS: Data Structures (AB-204 · 10:00 AM)...",
      async execute() {
        navigateTo("home");
        await loadHomeSummary();
      }
    },
    {
      num: 12,
      title: "Step 12: Fast Attendance Action",
      desc: "Fast attendance entry for the current class in one tap: Entering code 'A235646'...",
      async execute() {
        navigateTo("home");
        document.getElementById("quick-attendance-code").value = "A235646";
        await api("/attendance/mark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendance_code: "A235646" })
        });
        alert("✓ EXPO DEMO COMPLETE! All 12 academic workflows demonstrated seamlessly.");
      }
    }
  ],

  startDemo() {
    this.currentStep = 0;
    this.isPaused = false;
    const overlay = document.getElementById("expo-demo-overlay");
    if (overlay) overlay.classList.add("active");
    this.runCurrentStep();
  },

  closeDemo() {
    clearTimeout(this.timer);
    const overlay = document.getElementById("expo-demo-overlay");
    if (overlay) overlay.classList.remove("active");
  },

  async runCurrentStep() {
    if (this.currentStep >= this.steps.length) {
      this.closeDemo();
      return;
    }

    const s = this.steps[this.currentStep];
    document.getElementById("demo-step-badge").textContent = `STEP ${s.num} OF ${this.totalSteps}`;
    document.getElementById("demo-step-title").textContent = s.title;
    document.getElementById("demo-step-desc").textContent = s.desc;
    
    const pct = ((s.num) / this.totalSteps) * 100;
    document.getElementById("demo-progress-bar").style.width = `${pct}%`;

    try {
      await s.execute();
    } catch (e) {
      console.error(`Demo error in step ${s.num}:`, e);
    }

    if (!this.isPaused && this.currentStep < this.steps.length - 1) {
      this.timer = setTimeout(() => {
        this.nextStep();
      }, 4500);
    }
  },

  nextStep() {
    clearTimeout(this.timer);
    this.currentStep++;
    this.runCurrentStep();
  },

  togglePause() {
    this.isPaused = !this.isPaused;
    const btn = document.getElementById("demo-pause-btn");
    if (this.isPaused) {
      clearTimeout(this.timer);
      btn.textContent = "Resume";
    } else {
      btn.textContent = "Pause";
      this.nextStep();
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const nextBtn = document.getElementById("demo-next-btn");
  if (nextBtn) nextBtn.addEventListener("click", () => ExpoDemoModule.nextStep());

  const pauseBtn = document.getElementById("demo-pause-btn");
  if (pauseBtn) pauseBtn.addEventListener("click", () => ExpoDemoModule.togglePause());

  const closeBtn = document.getElementById("demo-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", () => ExpoDemoModule.closeDemo());
});
