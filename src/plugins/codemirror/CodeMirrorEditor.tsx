import { SandpackProvider, CodeEditor as TheEditorFromSandpack } from '@codesandbox/sandpack-react'
import React from 'react'
import styles from '../../styles/ui.module.css'
import { CodeBlockEditorProps } from '../codeblock'
import { useCodeBlockEditorContext } from '../codeblock/CodeBlockNode'
import { corePluginHooks } from '../core'
import { useCodeMirrorRef } from '../sandpack/useCodeMirrorRef'
export const atomDark = {
  "colors": {
    "surface1": "#282c34",
    "surface2": "#21252b",
    "surface3": "#2c313c",
    "clickable": "#a8b1c2",
    "base": "#a8b1c2",
    "disabled": "#4d4d4d",
    "hover": "#e8effc",
    "accent": "#c678dd",
    "error": "#e06c75",
    "errorSurface": "#ffeceb"
  },
  "syntax": {
    "plain": "#a8b1c2",
    "comment": {
      "color": "#757575",
      "fontStyle": "italic"
    },
    "keyword": "#c678dd",
    "tag": "#e06c75",
    "punctuation": "#a8b1c2",
    "definition": "#62aeef",
    "property": "#d19a66",
    "static": "#a8b1c2",
    "string": "#98c379"
  },
  "font": {
    "body": "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif, \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\"",
    "mono": "\"Fira Mono\", \"DejaVu Sans Mono\", Menlo, Consolas, \"Liberation Mono\", Monaco, \"Lucida Console\", monospace",
    "size": "13px",
    "lineHeight": "20px"
  }
}
export const CodeMirrorEditor = ({ language, nodeKey, code, focusEmitter, theme }: CodeBlockEditorProps) => {
  const initializeTheme = theme ? theme : atomDark
  const codeMirrorRef = useCodeMirrorRef(nodeKey, 'codeblock', 'jsx', focusEmitter)
  const [readOnly] = corePluginHooks.useEmitterValues('readOnly')
  const { setCode } = useCodeBlockEditorContext()

  React.useEffect(() => {
    codeMirrorRef.current?.getCodemirror()?.dom.addEventListener('paste', (e) => {
      e.stopPropagation()
    })
  }, [codeMirrorRef, language])

  return (
    <div
      className={styles.sandpackWrapper}
      onKeyDown={(e) => {
        e.stopPropagation()
      }}
    >
      <SandpackProvider theme={initializeTheme}>
        <TheEditorFromSandpack
          readOnly={readOnly}
          showLineNumbers
          initMode="immediate"
          key={language}
          filePath={`file.${language || 'txt'}`}
          code={code}
          onCodeUpdate={setCode}
          ref={codeMirrorRef}
        />
      </SandpackProvider>
    </div>
  )
}
