import { InitialEditorStateType } from '@lexical/react/LexicalComposer.js'
import { createEmptyHistoryState } from '@lexical/react/LexicalHistoryPlugin.js'
import { $isHeadingNode, HeadingTagType } from '@lexical/rich-text'
import { $setBlocksType } from '@lexical/selection'
import { $findMatchingParent, $insertNodeToNearestRoot, $wrapNodeInElement } from '@lexical/utils'
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isDecoratorNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $setSelection,
  BLUR_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  DecoratorNode,
  ElementNode,
  FOCUS_COMMAND,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  Klass,
  LexicalEditor,
  LexicalNode,
  ParagraphNode,
  RangeSelection,
  SELECTION_CHANGE_COMMAND,
  TextFormatType,
  TextNode,
  createCommand
} from 'lexical'
import * as Mdast from 'mdast'
import React from 'react'
import { LexicalConvertOptions, exportMarkdownFromLexical } from '../../exportMarkdownFromLexical'
import { RealmNode, realmPlugin, system } from '../../gurx'
import {
  MarkdownParseError,
  MarkdownParseOptions,
  MdastImportVisitor,
  UnrecognizedMarkdownConstructError,
  importMarkdownToLexical
} from '../../importMarkdownToLexical'
import type { JsxComponentDescriptor } from '../jsx'
import { LexicalLinebreakVisitor } from './LexicalLinebreakVisitor'
import { LexicalParagraphVisitor } from './LexicalParagraphVisitor'
import { LexicalRootVisitor } from './LexicalRootVisitor'
import { LexicalTextVisitor } from './LexicalTextVisitor'
import { MdastFormattingVisitor } from './MdastFormattingVisitor'
import { MdastInlineCodeVisitor } from './MdastInlineCodeVisitor'
import { MdastParagraphVisitor } from './MdastParagraphVisitor'
import { MdastRootVisitor } from './MdastRootVisitor'
import { MdastTextVisitor } from './MdastTextVisitor'
import { SharedHistoryPlugin } from './SharedHistoryPlugin'
import { noop } from '../../utils/fp'
import { controlOrMeta } from '../../utils/detectMac'
import { MdastBreakVisitor } from './MdastBreakVisitor'
import { type IconKey } from './Icon'
import { mdxJsxFromMarkdown, mdxJsxToMarkdown } from 'mdast-util-mdx-jsx'
import { mdxJsx } from 'micromark-extension-mdx-jsx'
import { MdastHTMLVisitor } from './MdastHTMLVisitor'
import { GenericHTMLNode } from './GenericHTMLNode'
import { LexicalGenericHTMLVisitor } from './LexicalGenericHTMLNodeVisitor'

export * from './GenericHTMLNode'

/** @internal */
export type EditorSubscription = (activeEditor: LexicalEditor) => () => void
type Teardowns = (() => void)[]

/** @internal */
export type BlockType = 'paragraph' | 'quote' | HeadingTagType | ''

/**
 * The type of the editor being edited currently. Custom editors can override this, so that the toolbar can change contents.
 */
export interface EditorInFocus {
  editorType: string
  rootNode: LexicalNode | null
}

/** @internal */
export const NESTED_EDITOR_UPDATED_COMMAND = createCommand<void>('NESTED_EDITOR_UPDATED_COMMAND')

/**
 * Add the the core system when creating systemf for your own plugins.
 * This gives you access to the component core state and logic, like the visitors, the lexical nodes, and the publishers used to insert nodes in the editor.
 */
export const coreSystem = system((r) => {
  function createAppendNodeFor<T>(node: RealmNode<T[]>) {
    const appendNode = r.node<T>()

    r.link(
      r.pipe(
        appendNode,
        r.o.withLatestFrom(node),
        r.o.map(([newValue, values]) => {
          if (values.includes(newValue)) {
            return values
          }
          return [...values, newValue]
        })
      ),
      node
    )
    return appendNode
  }

  const rootEditor = r.node<LexicalEditor | null>(null)
  const activeEditor = r.node<LexicalEditor | null>(null, true)
  const contentEditableClassName = r.node<string>('')
  const placeholderEditableClassName = r.node<string>('')
  const readOnly = r.node<boolean>(false)
  const placeholder = r.node<React.ReactNode>('')
  const autoFocus = r.node<boolean | { defaultSelection?: 'rootStart' | 'rootEnd'; preventScroll?: boolean }>(false)
  const inFocus = r.node(false, true)
  const currentFormat = r.node(0, true)
  const markdownProcessingError = r.node<{ error: string; source: string } | null>(null)
  const markdownErrorSignal = r.node<{ error: string; source: string }>()

  r.link(
    r.pipe(
      markdownProcessingError,
      r.o.filter((e) => e !== null)
    ),
    markdownErrorSignal
  )

  const applyFormat = r.node<TextFormatType>()
  const currentSelection = r.node<RangeSelection | null>(null)

  const activeEditorSubscriptions = r.node<EditorSubscription[]>([])
  const rootEditorSubscriptions = r.node<EditorSubscription[]>([])
  const editorInFocus = r.node<EditorInFocus | null>(null)

  const onBlur = r.node<FocusEvent>()

  const iconComponentFor = r.node<(name: IconKey) => React.ReactNode>((name: IconKey) => {
    throw new Error(`No icon component for ${name}`)
  })

  const rebind = () =>
    r.o.scan((teardowns, [subs, activeEditorValue]: [EditorSubscription[], LexicalEditor]) => {
      teardowns.forEach((teardown) => {
        if (!teardown) {
          throw new Error('You have a subscription that does not return a teardown')
        }
        teardown()
      })
      return activeEditorValue ? subs.map((s) => s(activeEditorValue)) : []
    }, [] as Teardowns)

  r.pipe(r.combine(activeEditorSubscriptions, activeEditor), rebind())
  r.pipe(r.combine(rootEditorSubscriptions, rootEditor), rebind())

  const createRootEditorSubscription = createAppendNodeFor(rootEditorSubscriptions)
  const createActiveEditorSubscription = createAppendNodeFor(activeEditorSubscriptions)

  function handleSelectionChange() {
    const selection = $getSelection()
    if ($isRangeSelection(selection)) {
      r.pubKeys({
        currentSelection: selection,
        currentFormat: selection.format
      })
    }
  }

  ////////////////////////
  // track the active editor - this is necessary for the nested editors
  ////////////////////////
  r.pub(createRootEditorSubscription, (theRootEditor) => {
    return theRootEditor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      (_, theActiveEditor) => {
        r.pubIn({
          [activeEditor.key]: theActiveEditor,
          [inFocus.key]: true
        })
        // doing stuff root editor restores the focus state
        if (theActiveEditor._parentEditor === null) {
          theActiveEditor.getEditorState().read(() => {
            r.pub(editorInFocus, {
              rootNode: $getRoot(),
              editorType: 'lexical'
            })
          })
        }
        handleSelectionChange()

        return false
      },
      COMMAND_PRIORITY_CRITICAL
    )
  })

  // Export handler
  r.pub(createRootEditorSubscription, (theRootEditor) => {
    return theRootEditor.registerUpdateListener(({ dirtyElements, dirtyLeaves, editorState }) => {
      const err = r.getValue(markdownProcessingError)
      if (err !== null) {
        return
      }
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) {
        return
      }

      let theNewMarkdownValue!: string

      editorState.read(() => {
        theNewMarkdownValue = exportMarkdownFromLexical({
          root: $getRoot(),
          visitors: r.getValue(exportVisitors),
          jsxComponentDescriptors: r.getValue(jsxComponentDescriptors),
          toMarkdownExtensions: r.getValue(toMarkdownExtensions),
          toMarkdownOptions: r.getValue(toMarkdownOptions),
          jsxIsAvailable: r.getValue(jsxIsAvailable)
        })
      })

      r.pub(markdown, theNewMarkdownValue.trim())
    })
  })

  const initialMarkdown = r.node<string>('')
  const markdown = r.node<string>('', true)
  const markdownSignal = r.node<string>()
  r.link(markdown, markdownSignal)
  r.link(initialMarkdown, markdown)

  // import configuration
  const importVisitors = r.node<MdastImportVisitor<Mdast.Content>[]>([])
  const syntaxExtensions = r.node<MarkdownParseOptions['syntaxExtensions']>([])
  const mdastExtensions = r.node<MarkdownParseOptions['mdastExtensions']>([])

  const usedLexicalNodes = r.node<Klass<LexicalNode>[]>([])

  // export configuration
  const exportVisitors = r.node<NonNullable<LexicalConvertOptions['visitors']>>([])
  const toMarkdownExtensions = r.node<NonNullable<LexicalConvertOptions['toMarkdownExtensions']>>([])
  const toMarkdownOptions = r.node<NonNullable<LexicalConvertOptions['toMarkdownOptions']>>({}, true)

  // the JSX plugin will fill in these
  const jsxIsAvailable = r.node<boolean>(false)
  const jsxComponentDescriptors = r.node<JsxComponentDescriptor[]>([])

  // used for the various popups, dialogs, and tooltips
  const editorRootElementRef = r.node<React.RefObject<HTMLDivElement> | null>(null)

  const addLexicalNode = createAppendNodeFor(usedLexicalNodes)
  const addImportVisitor = createAppendNodeFor(importVisitors)
  const addSyntaxExtension = createAppendNodeFor(syntaxExtensions)
  const addMdastExtension = createAppendNodeFor(mdastExtensions)
  const addExportVisitor = createAppendNodeFor(exportVisitors)
  const addToMarkdownExtension = createAppendNodeFor(toMarkdownExtensions)
  const setMarkdown = r.node<string>()

  function tryImportingMarkdown(markdownValue: string) {
    try {
      ////////////////////////
      // Import initial value
      ////////////////////////
      importMarkdownToLexical({
        root: $getRoot(),
        visitors: r.getValue(importVisitors),
        mdastExtensions: r.getValue(mdastExtensions),
        markdown: markdownValue,
        syntaxExtensions: r.getValue(syntaxExtensions)
      })
      r.pub(markdownProcessingError, null)
    } catch (e) {
      if (e instanceof MarkdownParseError || e instanceof UnrecognizedMarkdownConstructError) {
        r.pubIn({
          [markdown.key]: markdownValue,
          [markdownProcessingError.key]: {
            error: e.message,
            source: markdown
          }
        })
      } else {
        throw e
      }
    }
  }

  r.sub(
    r.pipe(
      setMarkdown,
      r.o.withLatestFrom(markdown, rootEditor, inFocus),
      r.o.filter(([newMarkdown, oldMarkdown]) => {
        return newMarkdown.trim() !== oldMarkdown.trim()
      })
    ),
    ([theNewMarkdownValue, , editor, inFocus]) => {
      editor?.update(() => {
        $getRoot().clear()
        tryImportingMarkdown(theNewMarkdownValue)

        if (!inFocus) {
          $setSelection(null)
        } else {
          editor.focus()
        }
      })
    }
  )

  // gets bound to the root editor state getter
  const initialRootEditorState = r.node<InitialEditorStateType>((theRootEditor) => {
    r.pub(rootEditor, theRootEditor)
    r.pub(activeEditor, theRootEditor)

    tryImportingMarkdown(r.getValue(initialMarkdown))

    const autoFocusValue = r.getValue(autoFocus)
    if (autoFocusValue) {
      if (autoFocusValue === true) {
        // Default 'on' state
        setTimeout(() => theRootEditor.focus(noop, { defaultSelection: 'rootStart' }))
        return
      }
      setTimeout(() =>
        theRootEditor.focus(noop, {
          defaultSelection: autoFocusValue.defaultSelection ?? 'rootStart'
        })
      )
    }
  })

  r.pub(createActiveEditorSubscription, (editor) => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        handleSelectionChange()
      })
    })
  })

  r.pub(createActiveEditorSubscription, (theEditor) => {
    return theEditor.registerCommand(
      BLUR_COMMAND,
      (payload) => {
        const theRootEditor = r.getValue(rootEditor)
        if (theRootEditor) {
          const movingOutside = !theRootEditor.getRootElement()?.contains(payload.relatedTarget as Node)
          if (movingOutside) {
            r.pubIn({
              [inFocus.key]: false,
              [onBlur.key]: payload
            })
          }
        }
        return false
      },
      COMMAND_PRIORITY_CRITICAL
    )
  })

  r.pub(createRootEditorSubscription, (theEditor) => {
    return theEditor.registerCommand(
      FOCUS_COMMAND,
      () => {
        r.pub(inFocus, true)
        return false
      },
      COMMAND_PRIORITY_CRITICAL
    )
  })

  // Fixes select all when frontmatter is present
  r.pub(createRootEditorSubscription, (theRootEditor) => {
    return theRootEditor.registerCommand<KeyboardEvent>(
      KEY_DOWN_COMMAND,
      (event) => {
        const { keyCode, ctrlKey, metaKey } = event
        if (keyCode === 65 && controlOrMeta(metaKey, ctrlKey)) {
          let shouldOverride = false

          theRootEditor.getEditorState().read(() => {
            shouldOverride = $isDecoratorNode($getRoot().getFirstChild()) || $isDecoratorNode($getRoot().getLastChild())
          })

          if (shouldOverride) {
            event.preventDefault()
            event.stopImmediatePropagation()
            theRootEditor.update(() => {
              const rootElement = theRootEditor.getRootElement() as HTMLDivElement
              window.getSelection()?.selectAllChildren(rootElement)
              rootElement.focus({
                preventScroll: true
              })
            })
            return true
          }
        }

        return false
      },
      COMMAND_PRIORITY_CRITICAL
    )
  })

  const composerChildren = r.node<React.ComponentType[]>([])
  const addComposerChild = createAppendNodeFor(composerChildren)

  const topAreaChildren = r.node<React.ComponentType[]>([])
  const addTopAreaChild = createAppendNodeFor(topAreaChildren)

  const editorWrappers = r.node<React.ComponentType<{ children: React.ReactNode }>[]>([])
  const addEditorWrapper = createAppendNodeFor(editorWrappers)

  const nestedEditorChildren = r.node<React.ComponentType[]>([])
  const addNestedEditorChild = createAppendNodeFor(nestedEditorChildren)

  const historyState = r.node(createEmptyHistoryState())

  r.sub(r.pipe(applyFormat, r.o.withLatestFrom(activeEditor)), ([format, theEditor]) => {
    theEditor?.dispatchCommand(FORMAT_TEXT_COMMAND, format)
  })

  const currentBlockType = r.node<BlockType | ''>('')
  const applyBlockType = r.node<BlockType>()

  r.sub(r.pipe(currentSelection, r.o.withLatestFrom(activeEditor)), ([selection, theEditor]) => {
    if (!selection || !theEditor) {
      return
    }

    const anchorNode = selection.anchor.getNode()
    let element =
      anchorNode.getKey() === 'root'
        ? anchorNode
        : $findMatchingParent(anchorNode, (e) => {
          const parent = e.getParent()
          return parent !== null && $isRootOrShadowRoot(parent)
        })

    if (element === null) {
      element = anchorNode.getTopLevelElementOrThrow()
    }

    const elementKey = element.getKey()
    const elementDOM = theEditor.getElementByKey(elementKey)

    if (elementDOM !== null) {
      const blockType = $isHeadingNode(element) ? element.getTag() : (element.getType() as BlockType)
      r.pub(currentBlockType, blockType)
    }
  })

  const convertSelectionToNode = r.node<() => ElementNode>()

  r.sub(r.pipe(convertSelectionToNode, r.o.withLatestFrom(activeEditor)), ([factory, editor]) => {
    editor?.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, factory)
        setTimeout(() => {
          editor.focus()
        })
      }
    })
  })

  const insertDecoratorNode = r.node<() => DecoratorNode<unknown>>()

  r.sub(r.pipe(insertDecoratorNode, r.o.withLatestFrom(activeEditor)), ([nodeFactory, theEditor]) => {
    theEditor?.focus(
      () => {
        theEditor.getEditorState().read(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            const focusNode = selection.focus.getNode()

            if (focusNode !== null) {
              theEditor.update(() => {
                const node = nodeFactory()
                if (node.isInline()) {
                  $insertNodes([node])
                  if ($isRootOrShadowRoot(node.getParentOrThrow())) {
                    $wrapNodeInElement(node, $createParagraphNode).selectEnd()
                  }
                } else {
                  $insertNodeToNearestRoot(node)
                }
                if ('select' in node && typeof node.select === 'function') {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                  setTimeout(() => node.select())
                }
              })

              setTimeout(() => {
                theEditor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined)
              })
            }
          }
        })
      },
      { defaultSelection: 'rootEnd' }
    )
  })

  r.sub(r.pipe(readOnly, r.o.withLatestFrom(rootEditor)), ([readOnly, theRootEditor]) => {
    theRootEditor?.setEditable(!readOnly)
  })

  return {
    // state
    activeEditor,
    inFocus,
    historyState,
    currentSelection,

    // jsx
    jsxIsAvailable,
    jsxComponentDescriptors,

    // lexical editor
    initialRootEditorState,
    rootEditor,
    createRootEditorSubscription,
    createActiveEditorSubscription,

    // import
    importVisitors,
    syntaxExtensions,
    mdastExtensions,
    usedLexicalNodes,
    addImportVisitor,
    addLexicalNode,
    addSyntaxExtension,
    addMdastExtension,

    // export
    toMarkdownExtensions,
    toMarkdownOptions,
    addToMarkdownExtension,
    addExportVisitor,
    exportVisitors,

    // markdown strings
    initialMarkdown,
    setMarkdown,
    markdown,
    markdownSignal,

    // DOM
    editorRootElementRef,
    contentEditableClassName,
    placeholderEditableClassName,
    placeholder,
    autoFocus,
    readOnly,

    // child controls
    composerChildren,
    addComposerChild,

    topAreaChildren,
    addTopAreaChild,

    nestedEditorChildren,
    addNestedEditorChild,

    editorWrappers,
    addEditorWrapper,

    // editor content state and commands
    currentFormat,
    editorInFocus,
    applyFormat,
    currentBlockType,
    applyBlockType,
    convertSelectionToNode,
    insertDecoratorNode,

    // Events
    onBlur,

    iconComponentFor,

    // error handling
    markdownProcessingError,
    markdownErrorSignal
  }
}, [])

interface CorePluginParams {
  initialMarkdown: string
  contentEditableClassName: string
  placeholderEditableClassName: string
  placeholder?: React.ReactNode
  autoFocus: boolean | { defaultSelection?: 'rootStart' | 'rootEnd'; preventScroll?: boolean | undefined }
  onChange: (markdown: string) => void
  onBlur?: (e: FocusEvent) => void
  onError?: (payload: { error: string; source: string }) => void
  toMarkdownOptions: NonNullable<LexicalConvertOptions['toMarkdownOptions']>
  readOnly: boolean
  iconComponentFor: (name: IconKey) => React.ReactElement
  suppressHtmlProcessing?: boolean,
  type: 'post' | 'article'
}

export const [
  /** @internal */
  corePlugin,
  /** @internal */
  corePluginHooks
] = realmPlugin({
  id: 'core',
  systemSpec: coreSystem,

  applyParamsToSystem(realm, params: CorePluginParams) {
    realm.pubKeys({
      contentEditableClassName: params.contentEditableClassName,
      placeholderEditableClassName: params.placeholderEditableClassName,
      toMarkdownOptions: params.toMarkdownOptions,
      autoFocus: params.autoFocus,
      placeholder: params.placeholder,
      readOnly: params.readOnly
    })
    realm.singletonSubKey('markdownSignal', params.onChange)
    realm.singletonSubKey('onBlur', params.onBlur)
    realm.singletonSubKey('markdownErrorSignal', params.onError)
  },

  init(realm, params: CorePluginParams) {
    realm.pubKey('initialMarkdown', params.initialMarkdown.trim())
    realm.pubKey('iconComponentFor', params.iconComponentFor)

    // core import visitors
    realm.pubKey('addImportVisitor', MdastRootVisitor)
    realm.pubKey('addImportVisitor', MdastParagraphVisitor)
    realm.pubKey('addImportVisitor', MdastTextVisitor)
    realm.pubKey('addImportVisitor', MdastFormattingVisitor)
    realm.pubKey('addImportVisitor', MdastInlineCodeVisitor)
    realm.pubKey('addImportVisitor', MdastBreakVisitor)

    // basic lexical nodes
    realm.pubKey('addLexicalNode', ParagraphNode)
    realm.pubKey('addLexicalNode', TextNode)
    realm.pubKey('addLexicalNode', GenericHTMLNode)

    // core export visitors
    realm.pubKey('addExportVisitor', LexicalRootVisitor)
    realm.pubKey('addExportVisitor', LexicalParagraphVisitor)
    realm.pubKey('addExportVisitor', LexicalTextVisitor)
    realm.pubKey('addExportVisitor', LexicalLinebreakVisitor)
    realm.pubKey('addExportVisitor', LexicalGenericHTMLVisitor)

    realm.pubKey('addComposerChild', SharedHistoryPlugin)

    // Use the JSX extension to parse HTML
    if (!params.suppressHtmlProcessing) {
      realm.pubKey('addMdastExtension', mdxJsxFromMarkdown())
      realm.pubKey('addSyntaxExtension', mdxJsx())
      realm.pubKey('addToMarkdownExtension', mdxJsxToMarkdown())
      realm.pubKey('addImportVisitor', MdastHTMLVisitor)
    }
  }
})
