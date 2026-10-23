import { ErrorBox } from "../../components/ui";

export default function DeleteConfirmation({text,busy,error,onCancel,onConfirm}:{text:string;busy:boolean;error:string;onCancel:()=>void;onConfirm:()=>void}) {
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
    <h2 id="delete-title">O‘chirishni tasdiqlaysizmi?</h2><p>{text}</p>
    {error&&<ErrorBox error={error}/>}<div className="button-row">
      <button className="button secondary" disabled={busy} onClick={onCancel}>Bekor qilish</button>
      <button className="button primary" disabled={busy} onClick={onConfirm}>{busy?'O‘chirilmoqda…':'O‘chirish'}</button>
    </div></div></div>;
}
