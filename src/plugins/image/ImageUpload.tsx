import React from 'react'
import { corePluginHooks } from '../core/index'
import { imagePluginHooks } from '.'
import styles from '../../styles/ui.module.css';

export const ImageUpload: React.FC = () => {
 const [readOnly, iconComponentFor] = corePluginHooks.useEmitterValues('readOnly', 'iconComponentFor')
 const saveImage = imagePluginHooks.usePublisher('saveImage');

 const handleUploadImage = (e: any) => {
  const file = e.target.files[0];
  saveImage({ file: file });
 }

 return (
  <div className={styles.externalUploadImage}>
   <input type="file" id="uploadFile" hidden onChange={handleUploadImage} />
   <label htmlFor="uploadFile">{iconComponentFor('upload_photo')}</label>
  </div>
 )
}