module.exports = [
  { intent: 'projects',     agent: 'project-manager',  description: 'project status, whats next, whats blocked, priorities across Shrody, OnlyHuman, Caligulas, Wombo, StoryBytes' },
  { intent: 'trainer',      agent: 'trainer',           description: 'log workouts, fitness plans, exercise analysis, gym sessions, sets, reps, weight' },
  { intent: 'nutritionist', agent: 'nutritionist',      description: 'food, meals, nutrition, diet, what to eat, calories, macros, analyse food photos' },
  { intent: 'psychologist', agent: 'psychologist',      description: 'mental health, stress, feelings, personal reflection, therapy, emotions' },
  { intent: 'ideas',        agent: 'ideas',             description: 'save a book idea, story idea, creative concept, writing inspiration' },
  { intent: 'improve',      agent: 'self-improvement',  description: 'self improvement recommendations, habits, productivity, personal growth suggestions' },
  { intent: 'image',        agent: 'comfyui',           description: 'generate an image, create artwork, draw something, visualise a character or scene' },
  { intent: 'general',      agent: null,                description: 'everything else, conversation, questions, advice' },
];
