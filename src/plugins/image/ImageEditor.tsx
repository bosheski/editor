import React from 'react'

import type { GridSelection, LexicalEditor, NodeSelection, RangeSelection } from 'lexical'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext.js'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection.js'
import { mergeRegister } from '@lexical/utils'
import classNames from 'classnames'
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  DRAGSTART_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  SELECTION_CHANGE_COMMAND
} from 'lexical'
import { imagePluginHooks } from '.'
import styles from '../../styles/ui.module.css'
import { corePluginHooks } from '../core'
import { $isImageNode } from './ImageNode'
import ImageResizer from './ImageResizer'

export interface MediaEditorProps {
  nodeKey: string
  src: string,
  alt?: string
  title?: string
  width: number | 'inherit'
  height: number | 'inherit'
}

const imageCache = new Set()

function useSuspenseImage(src: string) {
  if (!imageCache.has(src)) {
    throw new Promise((resolve) => {
      const img = new Image()
      img.src = src
      img.onerror = img.onload = () => {
        imageCache.add(src)
        resolve(null)
      }
    })
  }
}

function LazyImage({
  title,
  alt,
  className,
  imageRef,
  src,
  width,
  height
}: {
  title: string
  alt: string
  className: string | null
  imageRef: { current: HTMLImageElement | null }
  src: string
  width: number | 'inherit'
  height: number | 'inherit'
}): JSX.Element {
  useSuspenseImage(src)
  return (
    <img
      className={className || undefined}
      alt={alt}
      src={src}
      title={title}
      ref={imageRef}
      draggable="false"
      width={width}
      height={height}
    />
  )
}

export function ImageEditor({ src, title, alt, nodeKey, width, height }: MediaEditorProps): JSX.Element | null {
  const [type] = imagePluginHooks.useEmitterValues('type')
  if (type === 'post') {
    return null
  }
  const imageRef = React.useRef<any>(null)
  const buttonRef = React.useRef<HTMLButtonElement | null>(null)
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)
  const [showResizer, setShowResizer] = React.useState<boolean>(false)
  const [editor] = useLexicalComposerContext()
  const [selection, setSelection] = React.useState<RangeSelection | NodeSelection | GridSelection | null>(null)
  const activeEditorRef = React.useRef<LexicalEditor | null>(null)
  const [isResizing, setIsResizing] = React.useState<boolean>(false)
  const [disableImageResize] = imagePluginHooks.useEmitterValues('disableImageResize')
  const [imagePreviewHandler] = imagePluginHooks.useEmitterValues('imagePreviewHandler')
  const [mediaSource, setMediaSource] = React.useState({ src: '', type: '' })
  const [initialImagePath, setInitialImagePath] = React.useState<string | null>(null)
  const [iconComponentFor] = corePluginHooks.useEmitterValues('iconComponentFor')

  const onDelete = React.useCallback(
    (payload: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        const event: KeyboardEvent = payload
        event.preventDefault()
        const node = $getNodeByKey(nodeKey)
        if ($isImageNode(node)) {
          node.remove()
        }
      }
      return false
    },
    [isSelected, nodeKey]
  )
  const handleDeleteImage = React.useCallback(
    (e: React.MouseEvent, nodeKey: string) => {
      e.preventDefault()

      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isImageNode(node)) {
          node.remove()
        }
      })
    },
    [editor]
  )
  const onEnter = React.useCallback(
    (event: KeyboardEvent) => {
      const latestSelection = $getSelection()
      const buttonElem = buttonRef.current
      if (isSelected && $isNodeSelection(latestSelection) && latestSelection.getNodes().length === 1) {
        if (buttonElem !== null && buttonElem !== document.activeElement) {
          event.preventDefault()
          buttonElem.focus()
          return true
        }
      }
      return false
    },
    [isSelected]
  )

  const onEscape = React.useCallback(
    (event: KeyboardEvent) => {
      setShowResizer(false)
      return false
    },
    [editor, setSelected, setShowResizer]
  )

  React.useEffect(() => {
    if (imagePreviewHandler) {
      const callPreviewHandler = async () => {
        if (!initialImagePath) setInitialImagePath(src)
        const updatedSrc = await imagePreviewHandler(src)
        if (updatedSrc.endsWith('png') || updatedSrc.endsWith('jpg') || updatedSrc.endsWith('jpeg') || updatedSrc.endsWith('gif') || updatedSrc.endsWith('svg')) {
          setMediaSource({ src: updatedSrc, type: 'image' })
        } else {
          setMediaSource({ src: updatedSrc, type: 'video' })
        }
      }
      callPreviewHandler().catch(console.error)
    } else {
      if (src.endsWith('png') || src.endsWith('jpg') || src.endsWith('jpeg') || src.endsWith('gif') || src.endsWith('svg')) {
        setMediaSource({ src: src, type: 'image' })
      } else {
        setMediaSource({ src: src, type: 'video' })
      }
    }
  }, [src, imagePreviewHandler])

  React.useEffect(() => {
    let isMounted = true
    const unregister = mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        if (isMounted) {
          setSelection(editorState.read(() => $getSelection()))
        }
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        (_, activeEditor) => {
          activeEditorRef.current = activeEditor
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (payload) => {
          const event = payload
          if (isResizing) {
            return true
          }
          const button = buttonRef.current
          if (button !== null && button.contains(event.target as Node)) {
            setShowResizer(true);
            return true
          } else {
            setShowResizer(false);
          }

          if (event.target === imageRef.current) {
            // add drag pointer to the image
            if (event.shiftKey) {
              setSelected(!isSelected)
            } else {
              clearSelection()
              setSelected(true)
            }
            return true
          }

          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        DRAGSTART_COMMAND,
        (event) => {
          if (event.target === imageRef.current) {
            // TODO This is just a temporary workaround for FF to behave like other browsers.
            // Ideally, this handles drag & drop too (and all browsers).
            event.preventDefault()
            return true
          }
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(KEY_DELETE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ENTER_COMMAND, onEnter, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ESCAPE_COMMAND, onEscape, COMMAND_PRIORITY_LOW)
    )
    return () => {
      isMounted = false
      unregister()
    }
  }, [clearSelection, editor, isResizing, isSelected, nodeKey, onDelete, onEnter, onEscape, setSelected, showResizer])


  const onResizeEnd = (nextWidth: 'inherit' | number, nextHeight: 'inherit' | number) => {
    // Delay hiding the resize bars for click case
    setTimeout(() => {
      setIsResizing(false);
    }, 200);

    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isImageNode(node)) {
        node.setWidthAndHeight(nextWidth, nextHeight);
      }
    });
  };

  const onResizeStart = () => {
    setIsResizing(true);
  };

  const draggable = $isNodeSelection(selection)
  const isFocused = isSelected

  return mediaSource !== null ? (
    <React.Suspense fallback={null}>
      <div style={{ width: '100%', maxWidth: '100%' }}>
        <div className={styles.imageWrapper} style={{ maxWidth: "100%" }} data-editor-block-type="image">
          {mediaSource.type === 'video' ? (
            <div draggable={draggable}>
              <video
                width={width}
                height={height}
                style={{ maxWidth: "100%" }}
                className={classNames({
                  [styles.focusedImage]: isFocused
                })}
                src={mediaSource.src}
                title={title || ''}
                ref={imageRef}
                controls
              />
            </div>
          ) : (
            <div draggable={draggable}>

              <LazyImage
                width={width}
                height={height}
                className={classNames({
                  [styles.focusedImage]: isFocused
                })}
                src={mediaSource.src}
                title={title || ''}
                alt={alt || ''}
                imageRef={imageRef}
              />
            </div>
          )}
          {showResizer && !disableImageResize && (
            <ImageResizer editor={editor} imageRef={imageRef} onResizeStart={onResizeStart} onResizeEnd={onResizeEnd} />
          )}
          <button onClick={(event) => {
            handleDeleteImage(event, nodeKey);
          }} className={styles.imageDeleteButton}>
            X
          </button>
          <button
            type="button"
            className={classNames(styles.iconButton, styles.editImageButton)}
            title="Edit image"
            ref={buttonRef}
            onClick={() => {
              setShowResizer(!showResizer)
            }}
          >
            {iconComponentFor('settings')}
          </button>
        </div>
      </div>
    </React.Suspense>
  ) : null
}
