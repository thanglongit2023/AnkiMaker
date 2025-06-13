/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import {GoogleGenAI, GenerateContentResponse} from '@google/genai';
import { getDocument, GlobalWorkerOptions, PDFDocumentProxy, PDFPageProxy, TextItem } from 'pdfjs-dist/build/pdf.min.mjs';

// Configure PDF.js worker
GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.worker.min.mjs';


interface Flashcard {
  id: string; // Unique ID for each flashcard
  term: string;
  definition: string;
  hint?: string; // Optional hint for the card
  color?: string; // Optional background color for the card
  difficultyLevel?: 1 | 2 | 3; // Optional difficulty level
  isEditing?: boolean;
  originalTerm?: string;
  originalDefinition?: string;
  originalHint?: string;
  originalDifficultyLevel?: 1 | 2 | 3;
}

const DIFFICULTY_LEVEL_MAP: Record<number, string> = {
  1: "Level 1 (Remember/Understand)",
  2: "Level 2 (Analyze/Apply)",
  3: "Level 3 (Synthesize/Evaluate)",
};

const topicInput = document.getElementById('topicInput') as HTMLTextAreaElement;
const flashcardCountInput = document.getElementById('flashcardCount') as HTMLInputElement;
const generateButton = document.getElementById(
  'generateButton',
) as HTMLButtonElement;
const generateFromFileButton = document.getElementById(
  'generateFromFileButton',
) as HTMLButtonElement;
const importButton = document.getElementById(
  'importButton',
) as HTMLButtonElement;
const downloadButton = document.getElementById(
  'downloadButton',
) as HTMLButtonElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement; // For importing formatted TXT
const generateFromFileInput = document.getElementById('generateFromFileInput') as HTMLInputElement; // For PDF/TXT content
const flashcardsContainer = document.getElementById(
  'flashcardsContainer',
) as HTMLDivElement;
const errorMessage = document.getElementById('errorMessage') as HTMLDivElement;
const announcer = document.getElementById('announcer') as HTMLDivElement;


// SVG Icons
const editIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
const saveIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>`;
const cancelIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>`;


let flashcardsData: Flashcard[] = [];
const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

const cardColorsLight = [
  '#E3F2FD', '#FCE4EC', '#F3E5F5', '#E8EAF6', '#E0F2F1',
  '#FFF9C4', '#FFECB3', '#FFE0B2', '#F1F8E9', '#E1F5FE',
  '#F0F4C3', '#D7CCC8', '#CFD8DC', '#C8E6C9', '#B2EBF2'
];

let currentColorIndex = 0;
function getNextCardColor(): string {
  const color = cardColorsLight[currentColorIndex];
  currentColorIndex = (currentColorIndex + 1) % cardColorsLight.length;
  return color;
}

function displayError(message: string) {
  errorMessage.textContent = message;
  if (message) announcer.textContent = `Error: ${message}`;
}

function displaySuccess(message: string) {
  errorMessage.textContent = '';
  announcer.textContent = message;
}

function setGenerationControlsDisabled(disabled: boolean) {
    generateButton.disabled = disabled;
    generateFromFileButton.disabled = disabled;
    importButton.disabled = disabled;
    flashcardCountInput.disabled = disabled;
    topicInput.disabled = disabled;
}


async function parsePdfFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf: PDFDocumentProxy = await getDocument({ data: arrayBuffer }).promise;
  let fullTextContent = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page: PDFPageProxy = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    fullTextContent += textContent.items.map(item => (item as TextItem).str).join(' ') + '\n';
  }
  return fullTextContent;
}


function renderFlashcards() {
  flashcardsContainer.innerHTML = '';
  downloadButton.disabled = flashcardsData.length === 0;

  flashcardsData.forEach((flashcard) => {
    const cardWrapper = document.createElement('div');
    cardWrapper.classList.add('flashcard');
    cardWrapper.setAttribute('role', 'group');
    cardWrapper.setAttribute('aria-labelledby', `term-${flashcard.id}`);
    if (flashcard.isEditing) {
      cardWrapper.classList.add('editing');
    }

    const cardInner = document.createElement('div');
    cardInner.classList.add('flashcard-inner');
    if (flashcard.isEditing) {
        cardInner.classList.add('editing-inner');
    }

    const cardFront = document.createElement('div');
    cardFront.classList.add('flashcard-front');
    if (flashcard.color) cardFront.style.backgroundColor = flashcard.color;

    const cardBack = document.createElement('div');
    cardBack.classList.add('flashcard-back');
    if (flashcard.color) cardBack.style.backgroundColor = flashcard.color;

    if (flashcard.isEditing) {
      const form = document.createElement('form');
      form.classList.add('flashcard-edit-form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        saveFlashcard(flashcard.id);
      });

      const termLabel = document.createElement('label');
      termLabel.textContent = 'Term:';
      termLabel.htmlFor = `edit-term-${flashcard.id}`;
      const termInput = document.createElement('input');
      termInput.type = 'text';
      termInput.id = `edit-term-${flashcard.id}`;
      termInput.value = flashcard.term;
      termInput.required = true;
      termInput.setAttribute('aria-label', 'Edit term');

      const defLabel = document.createElement('label');
      defLabel.textContent = 'Definition:';
      defLabel.htmlFor = `edit-def-${flashcard.id}`;
      const definitionInput = document.createElement('textarea');
      definitionInput.id = `edit-def-${flashcard.id}`;
      definitionInput.value = flashcard.definition;
      definitionInput.rows = 3;
      definitionInput.required = true;
      definitionInput.setAttribute('aria-label', 'Edit definition');

      const hintLabel = document.createElement('label');
      hintLabel.textContent = 'Hint (optional):';
      hintLabel.htmlFor = `edit-hint-${flashcard.id}`;
      const hintInput = document.createElement('textarea');
      hintInput.id = `edit-hint-${flashcard.id}`;
      hintInput.value = flashcard.hint || '';
      hintInput.rows = 2;
      hintInput.setAttribute('aria-label', 'Edit hint');

      const difficultyLabel = document.createElement('label');
      difficultyLabel.textContent = 'Difficulty Level:';
      difficultyLabel.htmlFor = `edit-difficulty-${flashcard.id}`;
      const difficultySelect = document.createElement('select');
      difficultySelect.id = `edit-difficulty-${flashcard.id}`;
      difficultySelect.setAttribute('aria-label', 'Edit difficulty level');

      const defaultOption = document.createElement('option');
      defaultOption.value = "";
      defaultOption.textContent = "Select Difficulty";
      difficultySelect.appendChild(defaultOption);

      Object.entries(DIFFICULTY_LEVEL_MAP).forEach(([level, text]) => {
          const option = document.createElement('option');
          option.value = level;
          option.textContent = text;
          if (flashcard.difficultyLevel && parseInt(level, 10) === flashcard.difficultyLevel) {
              option.selected = true;
          }
          difficultySelect.appendChild(option);
      });


      const editActions = document.createElement('div');
      editActions.classList.add('flashcard-edit-actions');
      const saveButtonEl = createIconButton(saveIconSVG, 'Save changes', () => {});
      saveButtonEl.type = 'submit';
      const cancelButtonEl = createIconButton(cancelIconSVG, 'Cancel editing', () => cancelEdit(flashcard.id));

      editActions.append(saveButtonEl, cancelButtonEl);
      form.append(termLabel, termInput, defLabel, definitionInput, hintLabel, hintInput, difficultyLabel, difficultySelect, editActions);
      cardFront.appendChild(form);

    } else {
      // Display UI - Front
      const contentWrapperFront = document.createElement('div');
      contentWrapperFront.classList.add('flashcard-content-wrapper');
      const termDiv = document.createElement('div');
      termDiv.classList.add('term');
      termDiv.id = `term-${flashcard.id}`;
      termDiv.textContent = flashcard.term;
      contentWrapperFront.appendChild(termDiv);
      cardFront.appendChild(contentWrapperFront);

      // Display UI - Back
      const contentWrapperBack = document.createElement('div');
      contentWrapperBack.classList.add('flashcard-content-wrapper');
      const definitionDiv = document.createElement('div');
      definitionDiv.classList.add('definition');
      definitionDiv.textContent = flashcard.definition;
      contentWrapperBack.appendChild(definitionDiv);

      if (flashcard.hint) {
        const hintDiv = document.createElement('div');
        hintDiv.classList.add('hint');
        hintDiv.textContent = `Hint: ${flashcard.hint}`;
        contentWrapperBack.appendChild(hintDiv);
      }

      if (flashcard.difficultyLevel && DIFFICULTY_LEVEL_MAP[flashcard.difficultyLevel]) {
        const difficultyDiv = document.createElement('div');
        difficultyDiv.classList.add('difficulty-display');
        difficultyDiv.textContent = DIFFICULTY_LEVEL_MAP[flashcard.difficultyLevel];
        // Add difficulty to front or back - let's add to back for now
        contentWrapperBack.appendChild(difficultyDiv);
      }

      cardBack.appendChild(contentWrapperBack);

      // Actions for Front
      const actionsDivFront = document.createElement('div');
      actionsDivFront.classList.add('flashcard-actions', 'flashcard-actions-front');
      const editButtonFront = createIconButton(editIconSVG, 'Edit flashcard', () => toggleEditMode(flashcard.id));
      actionsDivFront.appendChild(editButtonFront);
      cardFront.appendChild(actionsDivFront);

      // Actions for Back
      const actionsDivBack = document.createElement('div');
      actionsDivBack.classList.add('flashcard-actions', 'flashcard-actions-back');
      const editButtonBack = createIconButton(editIconSVG, 'Edit flashcard', () => {
        if (cardWrapper.classList.contains('flipped')) {
            cardWrapper.classList.remove('flipped');
            setTimeout(() => toggleEditMode(flashcard.id), cardWrapper.classList.contains('editing') ? 0 : 50);
        } else {
            toggleEditMode(flashcard.id);
        }
      });
      actionsDivBack.appendChild(editButtonBack);
      cardBack.appendChild(actionsDivBack);

      cardWrapper.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.icon-button')) return;
        if (!cardWrapper.classList.contains('editing')) {
             cardWrapper.classList.toggle('flipped');
        }
      });
      cardWrapper.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            if (!cardWrapper.classList.contains('editing') && document.activeElement === cardWrapper) {
                 e.preventDefault();
                 cardWrapper.classList.toggle('flipped');
            }
        }
      });
      cardWrapper.tabIndex = 0;
    }

    cardInner.appendChild(cardFront);
    if (!flashcard.isEditing) {
        cardInner.appendChild(cardBack);
    }
    cardWrapper.appendChild(cardInner);
    flashcardsContainer.appendChild(cardWrapper);
  });
}

function createIconButton(svgHTML: string, ariaLabel: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.classList.add('icon-button');
  button.innerHTML = svgHTML;
  button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return button;
}

function toggleEditMode(id: string) {
  const card = flashcardsData.find(c => c.id === id);
  if (card) {
    const cardElement = flashcardsContainer.querySelector(`[aria-labelledby="term-${id}"]`) as HTMLElement;

    if (cardElement?.classList.contains('flipped') && !card.isEditing) {
        cardElement.classList.remove('flipped');
    }

    card.isEditing = !card.isEditing;
    if (card.isEditing) {
        card.originalTerm = card.term;
        card.originalDefinition = card.definition;
        card.originalHint = card.hint;
        card.originalDifficultyLevel = card.difficultyLevel;
    }

    renderFlashcards();

    if(card.isEditing){
        const termInputEl = document.getElementById(`edit-term-${id}`) as HTMLInputElement;
        termInputEl?.focus();
        announcer.textContent = `Editing flashcard: ${card.originalTerm}. Form is on the front of the card.`;
    } else {
        announcer.textContent = `Finished editing flashcard: ${card.term}.`;
        cardElement?.focus();
    }
  }
}

function saveFlashcard(id: string) {
  const card = flashcardsData.find(c => c.id === id);
  if (card && card.isEditing) {
    const termInputEl = document.getElementById(`edit-term-${id}`) as HTMLInputElement;
    const definitionInputEl = document.getElementById(`edit-def-${id}`) as HTMLTextAreaElement;
    const hintInputEl = document.getElementById(`edit-hint-${id}`) as HTMLTextAreaElement;
    const difficultySelectEl = document.getElementById(`edit-difficulty-${id}`) as HTMLSelectElement;

    card.term = termInputEl.value.trim();
    card.definition = definitionInputEl.value.trim();
    card.hint = hintInputEl.value.trim() || undefined;
    const selectedDifficulty = difficultySelectEl.value ? parseInt(difficultySelectEl.value, 10) as (1 | 2 | 3) : undefined;
    card.difficultyLevel = selectedDifficulty;

    if (!card.term || !card.definition) {
        displayError("Term and definition cannot be empty.");
        if (!card.term) termInputEl.focus();
        else definitionInputEl.focus();
        return;
    }

    card.isEditing = false;
    delete card.originalTerm;
    delete card.originalDefinition;
    delete card.originalHint;
    delete card.originalDifficultyLevel;
    renderFlashcards();
    displaySuccess(`Flashcard "${card.term}" updated.`);
    const cardElement = flashcardsContainer.querySelector(`[aria-labelledby="term-${id}"]`) as HTMLElement;
    cardElement?.focus();
  }
}

function cancelEdit(id: string) {
  const card = flashcardsData.find(c => c.id === id);
  if (card && card.isEditing) {
    card.term = card.originalTerm ?? card.term;
    card.definition = card.originalDefinition ?? card.definition;
    card.hint = card.originalHint ?? card.hint;
    card.difficultyLevel = card.originalDifficultyLevel ?? card.difficultyLevel;
    card.isEditing = false;
    delete card.originalTerm;
    delete card.originalDefinition;
    delete card.originalHint;
    delete card.originalDifficultyLevel;
    renderFlashcards();
    displaySuccess(`Editing cancelled for "${card.term}".`);
    const cardElement = flashcardsContainer.querySelector(`[aria-labelledby="term-${id}"]`) as HTMLElement;
    cardElement?.focus();
  }
}

async function callGeminiForFlashcards(promptContent: string, count: number, sourceDescription: string) {
    displayError('Generating flashcards...');
    setGenerationControlsDisabled(true);
    downloadButton.disabled = true;

    try {
        const prompt = `Generate ${count} flashcards based on the following content.
Each flashcard must have:
1. A 'Term'.
2. A concise 'Definition'.
3. A brief 'Hint' for context.
4. A 'Difficulty Level' (a number: 1, 2, or 3).

Assign difficulty levels based on these cognitive skills:
- Level 1 (Remember, Understand): Basic recall of facts, understanding concepts.
- Level 2 (Analyze, Apply): Breaking down information, using concepts in new situations.
- Level 3 (Synthesize, Evaluate): Combining information to form new ideas, making judgments.

Try to distribute the difficulty levels across the ${count} flashcards approximately as follows:
- Level 1: 25% of cards
- Level 2: 50% of cards
- Level 3: 25% of cards

Format each flashcard strictly as "Term: Definition: Hint: DifficultyLevel" on a new line. Do not include numbering or bullet points.
If a hint is not applicable, use a single hyphen "-" for the hint part.
Example:
Apple: A common, pomaceous fruit of the rose family: Grows on trees: 1
Moon: Earth's natural satellite: Reflects sunlight: 1
Photosynthesis: Process plants use to convert light energy into chemical energy: Occurs in chloroplasts: 2
Socioeconomic Impact of AI: Analysis of AI's effects on jobs, economy, and society: Requires critical thinking: 3

Content for generation:
${promptContent}`;

        const result: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-04-17',
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        const responseText = result.text;

        if (responseText) {
            const parsedFlashcards: Flashcard[] = responseText
                .split('\n')
                .map((line, idx): Flashcard | null => {
                    const parts = line.split(':');
                    // Expecting Term: Definition: Hint: DifficultyLevel
                    if (parts.length >= 4 && parts[0].trim()) {
                        const term = parts[0].trim();
                        const definition = parts[1].trim();
                        let hint = parts[2].trim();
                        if (hint === "-") hint = undefined; // Handle placeholder for no hint

                        const difficultyStr = parts[3].trim();
                        let difficultyLevel : 1 | 2 | 3 | undefined = undefined;
                        const parsedNum = parseInt(difficultyStr, 10);
                        if ([1,2,3].includes(parsedNum)) {
                            difficultyLevel = parsedNum as 1 | 2 | 3;
                        }

                        if (definition) { // Definition is mandatory
                            return {
                                id: `gen-${Date.now()}-${idx}`,
                                term,
                                definition,
                                hint: hint || undefined,
                                difficultyLevel,
                                color: getNextCardColor()
                            };
                        }
                    } else if (parts.length >= 2 && parts[0].trim()) { // Fallback for Term:Definition or Term:Definition:Hint
                        const term = parts[0].trim();
                        const definition = parts[1].trim();
                        const hint = parts.length > 2 ? parts.slice(2).join(':').trim() : undefined;
                         if (definition) {
                            return {
                                id: `gen-${Date.now()}-${idx}`,
                                term,
                                definition,
                                hint: hint || undefined,
                                // difficultyLevel will be undefined
                                color: getNextCardColor()
                            };
                        }
                    }
                    return null;
                })
                .filter((card): card is Flashcard => card !== null);

            if (parsedFlashcards.length > 0) {
                flashcardsData = parsedFlashcards;
                displaySuccess(`${parsedFlashcards.length} flashcards generated successfully ${sourceDescription}.`);
                topicInput.value = '';
            } else {
                displayError('No valid flashcards generated. Response might be empty or not in the expected format (Term:Definition:Hint:DifficultyLevel).');
            }
        } else {
            displayError('Failed to generate flashcards or received an empty response. Please try again.');
        }
    } catch (error: unknown) {
        console.error('Error generating content:', error);
        const detailedError = (error as Error)?.message || 'An unknown error occurred';
        displayError(`An error occurred during generation: ${detailedError}`);
    } finally {
        setGenerationControlsDisabled(false);
        renderFlashcards();
    }
}


generateButton.addEventListener('click', async () => {
  const topic = topicInput.value.trim();
  if (!topic) {
    displayError('Please enter a topic for generation.');
    topicInput.focus();
    return;
  }
  const count = parseInt(flashcardCountInput.value, 10) || 10;
  await callGeminiForFlashcards(topic, count, `for topic "${topic}"`);
});

generateFromFileButton.addEventListener('click', () => {
    generateFromFileInput.click();
});

generateFromFileInput.addEventListener('change', async (event) => {
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;

    const file = target.files[0];
    setGenerationControlsDisabled(true);
    downloadButton.disabled = true;
    displayError(`Processing "${file.name}"...`);

    try {
        let fileContent = "";
        if (file.name.endsWith('.txt')) {
            fileContent = await file.text();
        } else if (file.name.endsWith('.pdf')) {
            fileContent = await parsePdfFile(file);
        } else {
            displayError('Unsupported file type for generation. Please select a .txt or .pdf file.');
            generateFromFileInput.value = '';
            setGenerationControlsDisabled(false);
            return;
        }

        if (!fileContent.trim()) {
            displayError(`File "${file.name}" is empty or could not be read.`);
            generateFromFileInput.value = '';
            setGenerationControlsDisabled(false);
            return;
        }

        const count = parseInt(flashcardCountInput.value, 10) || 10;
        await callGeminiForFlashcards(fileContent, count, `from file "${file.name}"`);

    } catch (error) {
        console.error('Error processing file for generation:', error);
        displayError(`Error processing file: ${(error as Error).message}`);
    } finally {
        generateFromFileInput.value = '';
    }
});


importButton.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async (event) => {
  const target = event.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;

  const file = target.files[0];
  setGenerationControlsDisabled(true);
  downloadButton.disabled = true;
  displayError(`Importing "${file.name}"...`);

  try {
    let importedCards: Flashcard[] = [];
    if (file.name.endsWith('.txt') || file.name.endsWith('.csv')) {
      importedCards = await parseTextFileToImport(file);
    } else {
      displayError('Unsupported file type for import. Please select a .txt or .csv file with Term;Definition;Hint;DifficultyLevel format.');
      fileInput.value = '';
      setGenerationControlsDisabled(false);
      return;
    }

    if (importedCards.length > 0) {
      flashcardsData = flashcardsData.concat(importedCards);
      displaySuccess(`${importedCards.length} flashcards imported successfully from "${file.name}".`);
    } else {
      displayError(`No valid flashcards found in "${file.name}". Ensure format is Term;Definition;Hint;DifficultyLevel (one per line).`);
    }
  } catch (error) {
    console.error('Error importing file:', error);
    displayError(`Error importing file: ${(error as Error).message}`);
  } finally {
    fileInput.value = '';
    setGenerationControlsDisabled(false);
    renderFlashcards();
  }
});

async function parseTextFileToImport(file: File): Promise<Flashcard[]> {
  const text = await file.text();
  return text
    .split('\n')
    .map((line, idx): Flashcard | null => {
      const parts = line.split(';');
      if (parts.length >= 2 && parts[0].trim()) {
        const term = parts[0].trim();
        const definition = parts[1].trim();
        const hint = parts.length > 2 && parts[2].trim() ? parts[2].trim() : undefined;
        let difficultyLevel: 1 | 2 | 3 | undefined = undefined;
        if (parts.length > 3 && parts[3].trim()) {
            const parsedNum = parseInt(parts[3].trim(), 10);
            if ([1,2,3].includes(parsedNum)) {
                difficultyLevel = parsedNum as 1 | 2 | 3;
            }
        }

        if (definition) {
          return {
            id: `import-txt-${Date.now()}-${idx}`,
            term,
            definition,
            hint,
            difficultyLevel,
            color: getNextCardColor()
          };
        }
      }
      return null;
    })
    .filter((card): card is Flashcard => card !== null);
}


function downloadFlashcardsData() {
  if (flashcardsData.length === 0) {
    displayError("No flashcards to download.");
    return;
  }

  const dataToExport = flashcardsData.map(({ isEditing, originalTerm, originalDefinition, originalHint, originalDifficultyLevel, color, ...rest }) => rest);

  const filename = "flashcards.txt";
  const fileContent = dataToExport
    .map(card => `${card.term};${card.definition};${card.hint || ''};${card.difficultyLevel || ''}`)
    .join('\n');

  const blob = new Blob([fileContent], {type: 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  displaySuccess(`Flashcards downloaded as ${filename}`);
}

downloadButton.addEventListener('click', downloadFlashcardsData);

// Initial render
renderFlashcards();
if (flashcardsData.length === 0) {
    displayError("Enter a topic or provide a file to generate flashcards, or import existing ones.");
}
