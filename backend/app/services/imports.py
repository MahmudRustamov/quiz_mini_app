import hashlib
import shutil
from pathlib import Path
import pymupdf
from app.models import uid


def extract_pdf(content: bytes, directory: Path, prefix: str, ocr=False):
    directory.mkdir(parents=True, exist_ok=True)
    document = pymupdf.open(stream=content, filetype='pdf')
    if document.is_encrypted or document.page_count > 100:
        raise ValueError('Encrypted PDF or more than 100 pages')
    pages = []
    for index, page in enumerate(document):
        if page.rect.width * page.rect.height > 8_000_000:
            raise ValueError('PDF page dimensions are too large')
        text_blocks = [b for b in page.get_text('blocks') if b[6] == 0]
        left = [b for b in text_blocks if b[0] < page.rect.width * .45 and b[2] < page.rect.width * .65]
        right = [b for b in text_blocks if b[0] > page.rect.width * .45]
        two_columns = len(left) >= 2 and len(right) >= 2
        if two_columns:
            spanning = [b for b in text_blocks if b not in left and b not in right]
            blocks = sorted(spanning, key=lambda b: b[1]) + sorted(left, key=lambda b: b[1]) + sorted(right, key=lambda b: b[1])
        else:
            blocks = sorted(text_blocks, key=lambda b: (round(b[1] / 5), b[0]))
        text = '\n'.join(b[4].strip() for b in blocks)
        scanned = len(text.strip()) < 20
        warnings = []
        if scanned and ocr:
            if not shutil.which('tesseract'):
                warnings.append('Tesseract o‘rnatilmagan; sahifani qo‘lda tekshiring')
            else:
                try:
                    text = page.get_text(textpage=page.get_textpage_ocr(language='uzb+eng', dpi=150))
                except Exception:
                    warnings.append('OCR bajarilmadi; Tesseract til paketlarini tekshiring')
        filename = f'{uid()}-page-{index + 1}.png'
        # Full-page render preserves vector diagrams, formulas and image placement.
        page.get_pixmap(matrix=pymupdf.Matrix(1.25, 1.25)).save(directory / filename)
        images = []
        for image in page.get_images(full=True)[:30]:
            try:
                pixmap = pymupdf.Pixmap(document, image[0])
                if pixmap.n - pixmap.alpha > 3:
                    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pixmap)
                name = f'{uid()}.png'
                pixmap.save(directory / name)
                images.append(f'{prefix}/{name}')
            except (ValueError, RuntimeError):
                warnings.append('Bitta rasm alohida olinmadi; sahifa tasviri saqlangan')
        pages.append({'page': index + 1, 'text': text, 'two_columns': two_columns,
                      'scanned': scanned, 'page_image': f'{prefix}/{filename}', 'images': images,
                      'warnings': warnings})
    document.close()
    return {'pages': pages, 'sha256': hashlib.sha256(content).hexdigest(),
            'verification_required': True, 'message': 'Matn va kalitlarni o‘qituvchi tekshirishi shart'}
