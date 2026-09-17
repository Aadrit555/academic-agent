// 12-Step Interactive Classroom Add-on Expo Demonstration
const ExpoDemoModule = {
  currentStep: 0,
  timer: null,
  isPaused: false,
  totalSteps: 12,

  steps: [
    {
      num: 1,
      title: "Step 1: Open Google Classroom",
      desc: "Loading authentic Google Classroom environment with enrolled courses and active stream...",
      async execute() {
        await api("/demo/setup", { method: "POST" });
        await checkAuthStatus();
        await ClassroomModule.loadClassroom();
      }
    },
    {
      num: 2,
      title: "Step 2: Open Academic Agent Companion Add-on",
      desc: "Launching Academic Agent embedded companion add-on inside Google Classroom...",
      async execute() {
        navigateToAddonTab("home");
        await loadHomeSummary();
      }
    },
    {
      num: 3,
      title: "Step 3: Show Next Class with Exact Room",
      desc: "Checking timetable context: Digital Electronics (CSE 207) at 09:00 in Room C-1011...",
      async execute() {
        navigateToAddonTab("next-class");
        await TimetableModule.loadTimetable();
      }
    },
    {
      num: 4,
      title: "Step 4: Select Assignment from Classroom Stream",
      desc: "Classroom coursework detected: 'DAA LAB 4: Implement Merge Sort in C'...",
      async execute() {
        navigateToAddonTab("assignments");
        const daa = AppState.coursework.find(c => c.title.includes("Merge Sort"));
        if (daa) GeneratorModule.selectAssignment(daa.id);
      }
    },
    {
      num: 5,
      title: "Step 5: AI Dynamic Specification Extraction",
      desc: "AI reads assignment material and extracts required C code, test suite, benchmark CSV, and report...",
      async execute() {
        const daa = AppState.coursework.find(c => c.title.includes("Merge Sort"));
        if (daa) await GeneratorModule.updateAssignmentInfo();
      }
    },
    {
      num: 6,
      title: "Step 6: Synthesize Assignment Deliverables",
      desc: "Synthesizing MergeSort.c with modular divide-and-conquer implementation from course syllabus...",
      async execute() {
        await GeneratorModule.triggerGeneration();
      }
    },
    {
      num: 7,
      title: "Step 7: Execute Compiler Validation Pipeline",
      desc: "Compiling with gcc -Wall -Wextra, executing synthetic test cases, verifying zero compiler warnings...",
      async execute() {
        const daa = AppState.coursework.find(c => c.title.includes("Merge Sort"));
        if (daa) await ValidationModule.runValidation(daa.id);
      }
    },
    {
      num: 8,
      title: "Step 8: Configure Auto-Submit (4 Hours Before Deadline)",
      desc: "Enabling persistent automated Classroom turn-in scheduled for 4 hours prior to deadline...",
      async execute() {
        const daa = AppState.coursework.find(c => c.title.includes("Merge Sort"));
        if (daa) {
          await api(`/assignment/${daa.id}/schedule`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ coursework_id: daa.id, offset_hours: 4.0, auto_submit_enabled: true })
          });
          Toast.success("Auto-submit enabled for 4 hours before deadline.");
        }
      }
    },
    {
      num: 9,
      title: "Step 9: Ask Study Brain: Summarize Unit 2",
      desc: "Synthesizing structured summary from Unit-2.pdf with source page citations...",
      async execute() {
        navigateToAddonTab("study");
        await StudyBrainModule.loadStudyBrain();
        await StudyBrainModule.runAction("summary");
      }
    },
    {
      num: 10,
      title: "Step 10: Ask Study Brain: Generate 10 Questions",
      desc: "Generating high-yield exam and viva questions directly from course notes...",
      async execute() {
        navigateToAddonTab("study");
        await StudyBrainModule.runAction("questions");
      }
    },
    {
      num: 11,
      title: "Step 11: Launch Camera Attendance Scanner",
      desc: "Opening Google Lens-style attendance viewfinder with optical code recognition...",
      async execute() {
        navigateToAddonTab("attendance");
        await CameraScannerModule.loadRecentAttendance();
      }
    },
    {
      num: 12,
      title: "Step 12: Optical Code Detection & Authorized Mark",
      desc: "Scanning code 'A235646', matching active class context, and recording verified attendance...",
      async execute() {
        await CameraScannerModule.triggerCodeDetection("A235646");
        await CameraScannerModule.confirmAttendance();
        Toast.success("EXPO DEMO COMPLETE: All 12 Classroom Add-on workflows verified.");
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
    const badge = document.getElementById("demo-step-badge");
    const title = document.getElementById("demo-step-title");
    const desc = document.getElementById("demo-step-desc");
    const bar = document.getElementById("demo-progress-bar");

    if (badge) badge.textContent = `STEP ${s.num} OF ${this.totalSteps}`;
    if (title) title.textContent = s.title;
    if (desc) desc.textContent = s.desc;

    const pct = ((s.num) / this.totalSteps) * 100;
    if (bar) bar.style.width = `${pct}%`;

    try {
      await s.execute();
    } catch (e) {
      console.error(`Demo error in step ${s.num}:`, e);
    }

    if (!this.isPaused && this.currentStep < this.steps.length - 1) {
      this.timer = setTimeout(() => {
        this.nextStep();
      }, 4200);
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
      if (btn) btn.textContent = "Resume";
    } else {
      if (btn) btn.textContent = "Pause";
      this.nextStep();
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const startBtn = document.getElementById("start-expo-demo-btn");
  if (startBtn) startBtn.addEventListener("click", () => ExpoDemoModule.startDemo());

  const nextBtn = document.getElementById("demo-next-btn");
  if (nextBtn) nextBtn.addEventListener("click", () => ExpoDemoModule.nextStep());

  const pauseBtn = document.getElementById("demo-pause-btn");
  if (pauseBtn) pauseBtn.addEventListener("click", () => ExpoDemoModule.togglePause());

  const closeBtn = document.getElementById("demo-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", () => ExpoDemoModule.closeDemo());
});
