import logging
import shutil
from sqlalchemy import event
from app.core.config import get_settings

logger=logging.getLogger(__name__)

def delete_uploads_after_commit(db, exam_id):
    directory=get_settings().upload_dir/exam_id
    def cleanup(session):
        try:
            if directory.is_symlink(): directory.unlink()
            else: shutil.rmtree(directory)
        except FileNotFoundError:
            pass
        except OSError:
            logger.error('Draft upload cleanup failed for exam %s',exam_id)
    # Never remove files while the database transaction could still roll back.
    event.listen(db.sync_session,'after_commit',cleanup,once=True)
