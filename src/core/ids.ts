import { customAlphabet } from 'nanoid';
const random = customAlphabet('346789abcdefghjkmnpqrtwxyz', 6);
export const itemId = () => `i_${random()}`;
export const pageId = () => `p_${random()}`;
export const mediaId = () => `m_${random()}`;
