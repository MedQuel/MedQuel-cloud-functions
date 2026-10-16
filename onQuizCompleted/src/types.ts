export interface QuizCompletedEvent {
  sessionId: string;
  userId: string;
  quizType: string;
  contestId: string | null;
  subject: string;
  totalQuestions: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  score: number;
  scorePercent: number;
  timeTaken: number;
  epEarned: number;
  xpEarned: number;
  completedAt: string;
}
