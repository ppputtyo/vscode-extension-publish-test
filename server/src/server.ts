/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
  //追加
  CodeAction,
  TextEdit,
  TextDocumentEdit,
  CodeActionKind,
  Position,
  Range,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true,
      },
      // コードアクション
      codeActionProvider: true,
      // フォーマット
      documentFormattingProvider: true,
      // コマンド
      // executeCommandProvider: {
      //   commands: ["lsp-sample.reverse"],
      // },
    },
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log("Workspace folder change event received.");
    });
  }
});

// The example settings
interface ExampleSettings {
  maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration((change) => {
  if (hasConfigurationCapability) {
    // Reset all cached document settings
    documentSettings.clear();
  } else {
    globalSettings = <ExampleSettings>(
      (change.settings.languageServerExample || defaultSettings)
    );
  }

  // Revalidate all open text documents
  documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: "languageServerExample",
    });
    documentSettings.set(resource, result);
  }
  return result;
}

// Only keep settings for open documents
documents.onDidClose((e) => {
  documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
  validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  // In this simple example we get the settings for every validate run.
  const settings = await getDocumentSettings(textDocument.uri);

  // The validator creates diagnostics for all uppercase words length 2 and more
  const text = textDocument.getText();
  const pattern = /\b[A-Z]{2,}\b/g;
  let m: RegExpExecArray | null;

  let problems = 0;
  const diagnostics: Diagnostic[] = [];
  while ((m = pattern.exec(text)) && problems < settings.maxNumberOfProblems) {
    problems++;
    const diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Warning,
      range: {
        start: textDocument.positionAt(m.index),
        end: textDocument.positionAt(m.index + m[0].length),
      },
      message: `${m[0]} is all uppercase.`,
      source: "ex",
    };
    if (hasDiagnosticRelatedInformationCapability) {
      diagnostic.relatedInformation = [
        {
          location: {
            uri: textDocument.uri,
            range: Object.assign({}, diagnostic.range),
          },
          message: "Spelling matters",
        },
        {
          location: {
            uri: textDocument.uri,
            range: Object.assign({}, diagnostic.range),
          },
          message: "Particularly for names",
        },
      ];
    }
    diagnostics.push(diagnostic);
  }

  // Send the computed diagnostics to VSCode.
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VSCode
  connection.console.log("We received an file change event");
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    // The pass parameter contains the position of the text document in
    // which code complete got requested. For the example we ignore this
    // info and always provide the same completion items.
    return [
      {
        label: "TypeScript",
        kind: CompletionItemKind.Text,
        data: 1,
      },
      {
        label: "JavaScript",
        kind: CompletionItemKind.Text,
        data: 2,
      },
    ];
  }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  if (item.data === 1) {
    item.detail = "TypeScript details";
    item.documentation = "TypeScript documentation";
  } else if (item.data === 2) {
    item.detail = "JavaScript details";
    item.documentation = "JavaScript documentation";
  }

  return item;
});

connection.onCodeAction((params) => {
  const only: string | undefined =
    params.context.only != null && params.context.only.length > 0
      ? params.context.only[0]
      : undefined;

  if (only !== CodeActionKind.QuickFix) {
    return;
  }

  // この拡張機能が生成した警告のみを対象とする
  const diagnostics = params.context.diagnostics.filter(
    (diag) => diag.source === "ex"
  );

  // uriからドキュメントを取得
  const textDocument = documents.get(params.textDocument.uri);
  if (textDocument == null || diagnostics.length === 0) {
    return [];
  }

  const codeActions: CodeAction[] = [];

  diagnostics.forEach((diag) => {
    const title = "Fix to lower case";
    // 警告範囲のテキストを取得
    const originalText = textDocument.getText(diag.range);
    // 警告範囲のテキストを小文字に変換したものに置換
    const edits = [TextEdit.replace(diag.range, originalText.toLowerCase())];
    const editPattern = {
      documentChanges: [
        TextDocumentEdit.create(
          { uri: textDocument.uri, version: textDocument.version },
          edits
        ),
      ],
    };
    // コードアクションを生成
    const fixAction = CodeAction.create(
      title,
      editPattern,
      CodeActionKind.QuickFix
    );
    // コードアクションと警告を関連付ける
    fixAction.diagnostics = [diag];
    codeActions.push(fixAction);
  });

  return codeActions;
});

connection.onDocumentFormatting((params) => {
  // uriからドキュメントを取得
  const textDocument = documents.get(params.textDocument.uri);
  if (textDocument == null) {
    return;
  }
  // ドキュメントの行数を取得
  const lineCount = textDocument.lineCount;
  const insertText = `Formatting has been executed. (lineCount: ${lineCount})\n`;

  return [TextEdit.insert(Position.create(0, 0), insertText)];
});

// コマンド実行時に行う処理
connection.onExecuteCommand((params) => {
  if (
    params.command !== "lsp-sample-future-test.executeReverse" ||
    // params.command !== "lsp-sample.reverse" ||
    params.arguments == null
  ) {
    return;
  }
  const uri = params.arguments[0].external;
  // uriからドキュメントを取得
  const textDocument = documents.get(uri);
  if (textDocument == null) {
    return;
  }
  // バージョン不一致の場合はアーリーリターン
  const version = params.arguments[1];
  if (textDocument.version !== version) {
    return;
  }

  const selections = params.arguments[2];
  const changes: TextEdit[] = [];

  // 全ての選択範囲に対して実行
  for (const selection of selections) {
    // テキストを取得
    const text = textDocument.getText(selection);
    if (text.length === 0) {
      continue;
    }
    // 反転
    const reversed = text.split("").reverse().join("");

    changes.push(TextEdit.replace(selection, reversed));
  }

  if (changes.length === 0) {
    // テキスト全体を取得
    const text = textDocument.getText();
    // 反転
    const reversed = text.split("").reverse().join("");

    changes.push(
      TextEdit.replace(
        Range.create(
          Position.create(0, 0),
          textDocument.positionAt(text.length)
        ),
        reversed
      )
    );
  }

  // 変更を適用
  connection.workspace.applyEdit({
    documentChanges: [
      TextDocumentEdit.create(
        { uri: textDocument.uri, version: textDocument.version },
        changes
      ),
    ],
  });
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
