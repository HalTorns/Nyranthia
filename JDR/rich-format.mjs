const LOCAL_IMAGE = /^\/media\/[a-f0-9]{64}\.(png|jpg|webp)$/;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const blocks = new Set(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'image', 'horizontalRule']);
const marks = new Set(['bold', 'italic', 'underline', 'strike', 'highlight', 'annotation']);
export function validateRichSection(section, fail) {
  const notes = section.annotations;
  if (notes !== undefined) {
    if (!Array.isArray(notes) || notes.length > 1000) fail('Les annotations de la section sont invalides.');
    const ids = new Set();
    for (const note of notes) {
      if (!note || !ID.test(note.id) || ids.has(note.id) || typeof note.quote !== 'string' || note.quote.length > 10000 || typeof note.text !== 'string' || note.text.length > 50000 || typeof note.resolved !== 'boolean' || typeof note.createdAt !== 'string' || !Number.isFinite(Date.parse(note.createdAt))) fail('Une annotation est invalide.');
      ids.add(note.id);
    }
  }
  if (section.content === undefined) return;
  let count = 0;
  const visit = (node, depth = 0, parent = '') => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || ++count > 50000 || depth > 30) fail('Le contenu mis en forme est trop complexe ou invalide.');
    const type = node.type;
    if (depth === 0 ? type !== 'doc' : !blocks.has(type) && type !== 'text' && type !== 'hardBreak') fail('Un élément de mise en forme est inconnu.');
    if (['doc', 'blockquote', 'listItem'].includes(parent) && !blocks.has(type)) fail('La structure des paragraphes est invalide.');
    if (['bulletList', 'orderedList'].includes(parent) && type !== 'listItem') fail('La structure de la liste est invalide.');
    if (['paragraph', 'heading'].includes(parent) && !['text', 'hardBreak'].includes(type)) fail('Le contenu du paragraphe est invalide.');
    if (type === 'text' && (typeof node.text !== 'string' || node.text.length === 0 || node.text.length > 1_000_000)) fail('Un passage de texte est invalide.');
    if (node.attrs) {
      const allowed = { heading: ['level'], orderedList: ['start', 'type'], image: ['src', 'alt', 'title', 'width', 'height', 'size'] }[type] || [];
      if (Object.keys(node.attrs).some(key => !allowed.includes(key))) fail('Un attribut du document est inconnu.');
    }
    if (type === 'heading' && ![2, 3].includes(node.attrs?.level)) fail('Le niveau du titre est invalide.');
    if (type === 'orderedList' && (!Number.isSafeInteger(node.attrs?.start ?? 1) || (node.attrs?.start ?? 1) < 1 || (node.attrs?.start ?? 1) > 100000)) fail('La numérotation est invalide.');
    if (type === 'image') {
      if (!LOCAL_IMAGE.test(node.attrs?.src || '')) fail('Les images doivent être importées dans le livre.');
      for (const key of ['alt', 'title']) if (node.attrs[key] != null && (typeof node.attrs[key] !== 'string' || node.attrs[key].length > 2000)) fail('La description de l’image est invalide.');
      if (![50, 75, 100].includes(node.attrs.size ?? 100)) fail('La taille de l’image est invalide.');
      for (const key of ['width', 'height']) if (node.attrs[key] != null && (!Number.isFinite(node.attrs[key]) || node.attrs[key] <= 0 || node.attrs[key] > 20000)) fail('Les dimensions de l’image sont invalides.');
    }
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) fail('Les marques de texte sont invalides.');
      for (const mark of node.marks) {
        if (!mark || !marks.has(mark.type)) fail('La mise en forme contient une marque inconnue.');
        if (mark.type === 'annotation') {
          if (!ID.test(mark.attrs?.id || '') || Object.keys(mark.attrs).some(k => k !== 'id')) fail('L’ancrage d’une annotation est invalide.');
        } else if (mark.type === 'highlight') {
          if (mark.attrs && Object.entries(mark.attrs).some(([k, v]) => k !== 'color' || v !== null && !/^#[a-fA-F0-9]{6}$/.test(v))) fail('La couleur du surlignage est invalide.');
        } else if (mark.attrs && Object.keys(mark.attrs).length) fail('Une marque comporte un attribut inconnu.');
      }
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content) || ['text', 'image', 'hardBreak', 'horizontalRule'].includes(type)) fail('Le document est mal structuré.');
      for (const child of node.content) visit(child, depth + 1, type);
    }
  };
  visit(section.content);
}

export function imageKind(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { ext: 'png', type: 'image/png' };
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { ext: 'jpg', type: 'image/jpeg' };
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}
