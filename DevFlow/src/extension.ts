import * as vscode from 'vscode';
import { exec } from 'child_process';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';

// Define a type for response history entries
interface ResponseHistoryEntry {
    timestamp: number;
    response: string;
}

export function activate(context: vscode.ExtensionContext) {
    // Initialize or retrieve the response history from the global state
    let responseHistory: ResponseHistoryEntry[] = context.globalState.get('responseHistory') || [];

    let disposable = vscode.commands.registerCommand('extension.configureAndSetupProject', async () => {
        // Check if API key is already stored in global state
        let openaiApiKey = context.globalState.get<string>('openaiApiKey');

        if (!openaiApiKey) {
            // If not stored, prompt the user to enter the API key
            openaiApiKey = await vscode.window.showInputBox({
                prompt: 'Enter your OpenAI API key:',
                password: true,
            });

            if (!openaiApiKey) {
                // If the user cancels or doesn't provide a key, exit
                vscode.window.showWarningMessage('No OpenAI API key entered. Enter a valid API to proceed.');
                return;
            }

            // Save the API key to global state for future use
            context.globalState.update('openaiApiKey', openaiApiKey);
        }

        // Continue with the project setup
        const userPrompt = await vscode.window.showInputBox({
            prompt: 'Enter your prompt:'
        });

        if (userPrompt) {
            const customPrompt = `The following is the user prompt. You should give the complete code a noob needs to execute line by line,THERE SHOULD NOT BE ANY OTHER CHARACTER BEFORE COMMANDS IN EACH LINE:  "${userPrompt}"`;
            try {
                const response = await generateSetupCommands(openaiApiKey, customPrompt, responseHistory);

                // Save the response to response history with a timestamp
                const timestamp = Date.now();
                responseHistory.push({ timestamp, response });
                
                // Limit the response history to the last two entries
                responseHistory = responseHistory.slice(-2);

                context.globalState.update('responseHistory', responseHistory);

                // Display the response in a new webview panel
                displayApiResponse(response);

                const lines = response.split('\n');

                // Use regular expressions to filter out lines that seem to be commands
                const commandLines = lines
                .map(line => line.replace(/^\s*\d+[.)]\s*/, '')) // Remove leading numbers with dot or parenthesis
                .filter(line => line.trim() !== ''); // Filter out empty lines after removal

                // Join the command lines into a single string
                const commandString = commandLines.join('\n');

                // Run the generated commands in the terminal
                const terminal = vscode.window.createTerminal('DevFlow Running');
                terminal.sendText(commandString);
                terminal.show();

                vscode.window.showInformationMessage('DevFlow Executed!');
            } catch (error: any) {
                vscode.window.showErrorMessage(`DevFlow failed to proceed: ${error.message}`);
            }
        } else {
            vscode.window.showWarningMessage('No project description entered. Project setup canceled.');
        }
    });

    // Add a command to clear the response history
    let clearHistoryDisposable = vscode.commands.registerCommand('extension.clearResponseHistory', () => {
        responseHistory = [];
        context.globalState.update('responseHistory', responseHistory);
        vscode.window.showInformationMessage('Response history cleared.');
    });

    // Add a command to transcribe audio
    let transcribeAudioDisposable = vscode.commands.registerCommand('extension.transcribeAudio', async () => {
        await transcribeAudio(context);
    });

    context.subscriptions.push(transcribeAudioDisposable);
}

function displayApiResponse(response: string): void {
    // Get or create the output channel
    const outputChannel = vscode.window.createOutputChannel('API Response');

    // Append the response to the output channel
    outputChannel.appendLine(response);

    // Show the output channel
    outputChannel.show(true);
}

async function transcribeAudio(context: vscode.ExtensionContext) {
  const options: vscode.OpenDialogOptions = {
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      'Audio files': ['wav', 'mp3','ogg'],
    },
  };

  try {
    const audioFileUri = await vscode.window.showOpenDialog(options);
    if (audioFileUri && audioFileUri[0]) {
      const audioFilePath = audioFileUri[0].fsPath;

      const apiKey = context.globalState.get<string>('openaiApiKey');
      const apiUrl = 'https://api.openai.com/v1/audio/transcriptions';

      const config = {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'multipart/form-data',
        },
      };


      const audioFile = fs.readFileSync(audioFilePath);
      const audioBlob = new Blob([audioFile]);

      const formData = new FormData();
      formData.append('model', 'whisper-1');
      formData.append('file', audioBlob, path.basename(audioFilePath));

      const response = await axios.post(apiUrl, formData, config);
      const transcript = response.data.text;

      const outputChannel = vscode.window.createOutputChannel('Transcription');
      outputChannel.appendLine(transcript);
      outputChannel.show();
    } else {
      vscode.window.showInformationMessage('No audio file selected');
    }
  } catch (error) {
    vscode.window.showErrorMessage('Error transcribing audio');
    console.error(error);
  }
}

async function generateSetupCommands(apiKey: string, projectDescription: string, responseHistory: ResponseHistoryEntry[]): Promise<string> {
    const openaiApiEndpoint = 'https://api.openai.com/v1/completions';
    const prompt = `Understand the user prompt and give ONLY terminal package installation codes. ${projectDescription}`;
    
    // Combine the current prompt with the context from response history
    const context = responseHistory.map(entry => entry.response).join('\n');
    const combinedPrompt = `${prompt}\n\nPrevious responses:\n${context}`;

    try {
        const response = await axios.post(
            openaiApiEndpoint,
            {
                prompt: combinedPrompt,
                model:"text-davinci-003",
                max_tokens: 400,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
            }
        );

        if (!response.data.choices || !Array.isArray(response.data.choices)) {
            throw new Error('Unexpected OpenAI API response format');
        }

        const generatedCommands = response.data.choices.map((choice: any) => choice.text.trim()).join('\n');
        return generatedCommands;
    } catch (error: any) {
        throw new Error(`Failed to generate setup commands from OpenAI API: ${error.message}`);
    }
}

export function deactivate() {}
