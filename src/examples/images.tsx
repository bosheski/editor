import React from 'react'
import { DiffSourceToggleWrapper, InsertImage, MDXEditor, diffSourcePlugin, imagePlugin, jsxPlugin, toolbarPlugin } from '../'
import axios from 'axios';
const markdownWithHtmlImages = `
Hello world

![alt text](https://picsum.photos/200/300)

some more

<img src="https://picsum.photos/200/300" width="200" height="300" />

<img src="https://picsum.photos/200/300" />

<img src="https://picsum.photos/200/300" width="200" height="300" /> some <img src="https://picsum.photos/200/300" /> flow

some
`

export function HtmlImage() {
  return (
    <>
      <MDXEditor
        markdown={markdownWithHtmlImages}
        plugins={[
          imagePlugin({ imageUploadHandler: async () => Promise.resolve('https://picsum.photos/200/300') }),
          diffSourcePlugin(),
          toolbarPlugin({ toolbarContents: () => <DiffSourceToggleWrapper>:)</DiffSourceToggleWrapper> })
        ]}
        onChange={console.log}
      />
    </>
  )
}

export function JsxImage() {
  return (
    <>
      <MDXEditor
        markdown={markdownWithHtmlImages}
        plugins={[
          imagePlugin({ disableImageResize: true }),
          diffSourcePlugin(),
          jsxPlugin(),
          toolbarPlugin({ toolbarContents: () => <DiffSourceToggleWrapper>:)</DiffSourceToggleWrapper> })
        ]}
        onChange={console.log}
      />
    </>
  )
}

export function ImageWithPreviewHook() {
  return (
    <>
      <MDXEditor
        photoUploadPosition='outside'
        markdown="Preview hook that returns static base64: ![alt text](/attachments/my_image.png)"
        plugins={[
          imagePlugin({
            imagePreviewHandler: async () =>
              Promise.resolve(
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAYCAYAAABurXSEAAAAAXNSR0IArs4c6QAAAGJlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAABJKGAAcAAAASAAAAUKABAAMAAAABAAEAAKACAAQAAAABAAAALaADAAQAAAABAAAAGAAAAABBU0NJSQAAAFNjcmVlbnNob3QGyMkKAAAB1GlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNi4wLjAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczpleGlmPSJodHRwOi8vbnMuYWRvYmUuY29tL2V4aWYvMS4wLyI+CiAgICAgICAgIDxleGlmOlBpeGVsWURpbWVuc2lvbj4yNDwvZXhpZjpQaXhlbFlEaW1lbnNpb24+CiAgICAgICAgIDxleGlmOlBpeGVsWERpbWVuc2lvbj40NTwvZXhpZjpQaXhlbFhEaW1lbnNpb24+CiAgICAgICAgIDxleGlmOlVzZXJDb21tZW50PlNjcmVlbnNob3Q8L2V4aWY6VXNlckNvbW1lbnQ+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgq7qfQQAAADGUlEQVRYCWP8DwQMQwwwDTH3gp076mh6xdpoSA+7kH795g3DspWrGV68eAn229Vr18H8P3/+kO5XUJGHDeQWlfxX0zHAJvX/y5cv/wUlZP5390/EKo9N8PSZs2A9Bw4eAktPnDINzP/27Rs25XjFcKbpf3//Mnz/8QNrKABNBIv/+/cPqzytBXE6mtYWU2I+1Rz9+fMXhsbWdgZTa3sGOVVNBmDyYrhz9y5Jbtuzbz9DXFIqg5CkLIOtsxtDc3snw/fv3zHMoIqj/wKTUnpOHgMwnTLYWFkyJCfEMezavZchIDSS4e27dxiWYhM4dOQoQ1h0HMNtoEfLiwsZtDU1GfonTWFIz85jAJmPDFiQOehsYIYDWhyBLszw+/dvFLEdu/cw7Ni1m2HGlIkMYcFBYLmQwABwaM1dsIihrKgART02TnF5FYOCvBzDzs0bGfj4eMFKdLS1GOqaWhgOHDrM4OzoANdGMKQ5ODgY0DEnJyfcABDj/IWLYL6CnBzDhUuXwfg3tCg7ceoUilpsHFDg3L13jyEqIhzuYJC62OhIsPJLl6+gaMMb0jw8PAwrFi9A0QDigCwBpVsYOHfhApjp4RcIE4LTV69eh7NxMe49eACWUpSXR1HCz8fHAHLDrdt3UMTxOhpFJR6OproGw4GDhxluX73IwMSEGnnofGzGyEhLg4WfPX+OIg3KhKAAAiUbZIBqA7IMCWx9PR2w6mvXbzAICgjA8aHDRxjOnD1H0CQhQUEGKUlJhg2btwDzC6KG3L5zN1ivjo42ihlUcbSHqyuDupoqQ3RCMsO0mbMZtmzfwZBTUMSQmJbJ8ODhIxQLcXGqykvBeSMxLZ1h3YZNDBMmT2VIycxmMDTQZ3Cyt0PRhjN5MKJFM7IuRkZGMBdGg3L7qqWLGEoraxhqGprAcqC02FBTxZAUH4uslYEBTS/MjKjwUIavX78yzJo7H+xYkCYvDzeGvs4OBvSMzwiq5FFNpYz3C1gcfvzwkUFYWAgjfRNr8vsPHxh4gZ5mYcEeplR3NLEOo0QdVdI0JQ4gR++oo8kJNXL0AADsUIxP1kwKcwAAAABJRU5ErkJggg=='
              )
          }),
          diffSourcePlugin(),
          jsxPlugin(),
          toolbarPlugin({ toolbarContents: () => <DiffSourceToggleWrapper>:)</DiffSourceToggleWrapper> })
        ]}
        onChange={console.log}
      />
    </>
  )
}

export function ImageDialogButtonExample() {
  const [uploadProgress, setUploadProgress] = React.useState<number | undefined>(0)
  const [selectedFile, setSelectedFile] = React.useState<File | undefined>(undefined)
  const [preview, setPreview] = React.useState<string | undefined>(undefined)
  React.useEffect(() => {
    if (!selectedFile) return
    const objectURL = URL.createObjectURL(selectedFile)
    setPreview(objectURL)
    return () => {
      URL.revokeObjectURL(objectURL)
      setPreview(undefined)
    }
  }, [selectedFile])
  return (
    <>
      <MDXEditor
        markdown=""
        plugins={[
          toolbarPlugin({ toolbarContents: () => <InsertImage /> }),
          diffSourcePlugin(),
          jsxPlugin(),]}
        photoUploadPosition='outside'
      />
      {preview && <img src={preview} />}
      <div>Upload progress: {uploadProgress}%</div>
    </>
  )
}
