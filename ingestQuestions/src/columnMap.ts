const HEADER_ALIASES: Record<string, string> = {
  'question text': 'questionText',
  'option a': 'optionA',
  'option b': 'optionB',
  'option c': 'optionC',
  'option d': 'optionD',
  'correct answer': 'correctAnswer',
  explanation: 'explanation',
  subject: 'subject',
  topic: 'topic',
  subtopic: 'subtopic',
  difficulty: 'difficulty',
  'question type': 'questionType',
  'image url': 'imageUrl',
  marks: 'marks',
  'target exams': 'targetExams',
  tags: 'tags',
  'is premium': 'isPremium',
};


function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildColumnIndex(headerRowValues: unknown[]): Map<number, string> {
  const index = new Map<number, string>();

  headerRowValues.forEach((cell, columnNumber) => {
    if (typeof cell !== 'string') return;
    const field = HEADER_ALIASES[normalizeHeader(cell)];
    if (field) index.set(columnNumber, field);
  });

  return index;
}

export function extractRowFields(rowValues: unknown[], columnIndex: Map<number, string>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  columnIndex.forEach((fieldName, columnNumber) => {
    fields[fieldName] = rowValues[columnNumber];
  });

  return fields;
}
