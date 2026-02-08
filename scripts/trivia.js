export function pickQuestionById(triviaData, id) {
  return triviaData.find((question) => question.id === id) || null;
}

export function getRandomQuestion(triviaData, usedIds) {
  const unused = triviaData.filter((question) => !usedIds.includes(question.id));
  if (unused.length === 0) {
    return triviaData[Math.floor(Math.random() * triviaData.length)];
  }
  return unused[Math.floor(Math.random() * unused.length)];
}
