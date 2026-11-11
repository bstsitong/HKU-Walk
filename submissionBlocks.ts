import type { PickedImage } from './communityApi';

export type BodyBlockType = 'paragraph' | 'heading' | 'list' | 'quote' | 'image';
export type BodyBlock = { type: BodyBlockType; text: string; imageUrl?: string; sourceIndex?: number };
export type DraftBodyBlock = BodyBlock & { id: string; image?: PickedImage };
export const maxBodyBlocks = 40;
export const maxBodyImages = 12;

let nextBlockId = 0;
export function newBodyBlock(type: BodyBlockType = 'paragraph', text = '', image?: PickedImage): DraftBodyBlock {
  return { id: String(++nextBlockId), type, text, image };
}

export function editBodyBlocks(blocks: BodyBlock[] = [], body = ''): DraftBodyBlock[] {
  if (!blocks.length) return [newBodyBlock('paragraph', body)];
  return blocks.map(block => ({ ...newBodyBlock(block.type, block.text), ...block }));
}

export function serializeBodyBlocks(blocks: DraftBodyBlock[]) {
  const uploads: { index: number; image: PickedImage }[] = [];
  const inherit: Record<string, number> = {};
  const data = blocks.filter(block => block.type === 'image' || block.text.trim()).map((block, index) => {
    if (block.type === 'image') {
      if (block.image) uploads.push({ index, image: block.image });
      else if (block.imageUrl && typeof block.sourceIndex === 'number') inherit[String(index)] = block.sourceIndex;
    }
    return { type: block.type, text: block.text.trim() };
  });
  return { data, uploads, inherit };
}
