"use client";
import { useMemo, useState } from "react";
import { addPaise, calculateLineTotalPaise, parseDate, parseMoney, parseQuantity } from "@/lib/checks";
import { isTemporaryPoNumber } from "@/lib/po-number";

type LineItem = { sku:string; description:string; quantity:number; unitPricePaise:number; lineTotalPaise:number };
type DraftItem = { sku:string; description:string; quantity:string; unitPrice:string; lineTotal:string };
type Props = {
  id:string;
  poNumber:string;
  poDate:string;
  vendorName:string;
  documentTotalPaise:number;
  extractionMethod:string;
  extractionWarnings:string[];
  status:string;
  lineItems:LineItem[];
  editable:boolean;
  approverCanDecide:boolean;
};

function displayDate(value:string) {
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

export default function PoReview(props:Props) {
  const missingExtractedNumber = isTemporaryPoNumber(props.poNumber);
  const [header, setHeader] = useState({
    poNumber: missingExtractedNumber ? "" : props.poNumber,
    poDate:displayDate(props.poDate),
    vendorName:props.vendorName,
    documentTotal:(props.documentTotalPaise/100).toFixed(2)
  });
  const [items, setItems] = useState<DraftItem[]>(props.lineItems.map(item => ({
    sku:item.sku,
    description:item.description,
    quantity:String(item.quantity),
    unitPrice:(item.unitPricePaise/100).toFixed(2),
    lineTotal:(item.lineTotalPaise/100).toFixed(2)
  })));
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [fieldErrors,setFieldErrors] = useState<Record<string,string>>({});
  const [reason,setReason] = useState("");
  const [pending,setPending] = useState<"save"|"submit"|"approve"|"reject"|null>(null);

  const calculated = useMemo(() => items.reduce((sum,item) => sum + (parseMoney(item.lineTotal) ?? 0),0),[items]);
  const documentTotal = parseMoney(header.documentTotal) ?? 0;
  const formatPaise = (paise:number) => new Intl.NumberFormat("en-IN", { style:"currency", currency:"INR" }).format(paise/100);
  const lineChecks = items.map(item => {
    const quantity = item.quantity.trim() ? parseQuantity(Number(item.quantity)) : null;
    const unitPrice = parseMoney(item.unitPrice);
    const lineTotal = parseMoney(item.lineTotal);
    const expected = quantity === null ? null : calculateLineTotalPaise(quantity, unitPrice ?? 0);
    return lineTotal !== null && expected !== null && Math.abs(expected-lineTotal) <= 100;
  });
  const lineMathMismatch = items.some(item => {
    const quantity = item.quantity.trim() ? parseQuantity(Number(item.quantity)) : null;
    const unitPrice = parseMoney(item.unitPrice);
    const lineTotal = parseMoney(item.lineTotal);
    const expected = quantity === null ? null : calculateLineTotalPaise(quantity, unitPrice ?? 0);
    return expected === null || lineTotal === null || Math.abs(expected - lineTotal) > 100;
  });
  const poMismatch = items.length > 0 && Math.abs(calculated-documentTotal)>100;
  const detailsPass = Boolean(header.poNumber.trim() && parseDate(header.poDate) && header.vendorName.trim() && documentTotal > 0);
  const visibleExtractionWarnings = props.extractionWarnings.filter((warning) => {
    if (warning.startsWith("PO number was not recognized")) return !header.poNumber.trim();
    if (warning.startsWith("PO date was not recognized")) return !parseDate(header.poDate);
    if (warning.startsWith("Vendor name was not recognized")) return !header.vendorName.trim();
    if (warning.startsWith("PO total was not recognized")) return documentTotal <= 0;
    if (warning.startsWith("Line items were not recognized")) return items.length === 0;
    if (warning.startsWith("One or more line-item calculations do not match")) return lineMathMismatch;
    if (warning.startsWith("The calculated line-item total does not match")) return poMismatch;
    return true;
  });

  function clearFieldError(key:string) {
    setFieldErrors(current => {
      if (!current[key]) return current;
      const next = {...current};
      delete next[key];
      return next;
    });
  }

  function validateForSubmit() {
    const errors:Record<string,string> = {};
    if (!header.poNumber.trim() || isTemporaryPoNumber(header.poNumber.trim())) errors.poNumber="Enter the actual PO number from the document";
    if (!parseDate(header.poDate)) errors.poDate="Enter a valid date (DD-MM-YYYY)";
    if (!header.vendorName.trim()) errors.vendorName="Vendor is required";
    const total = parseMoney(header.documentTotal);
    if (total === null || total <= 0) errors.documentTotal="Enter a positive PO total";
    if (items.length === 0) errors.lineItems="Add at least one line item";

    let lineSum = 0;
    items.forEach((item,index) => {
      const prefix=`lineItems.${index}`;
      const quantity=item.quantity.trim()?parseQuantity(Number(item.quantity)):null;
      const unitPrice=parseMoney(item.unitPrice);
      const lineTotal=parseMoney(item.lineTotal);
      if (!item.sku.trim()) errors[`${prefix}.sku`]="SKU is required";
      if (!item.description.trim()) errors[`${prefix}.description`]="Description is required";
      if (quantity === null) errors[`${prefix}.quantity`]="Enter a positive whole number within the supported range";
      if (unitPrice === null || unitPrice <= 0) errors[`${prefix}.unitPrice`]="Enter a positive unit price";
      if (lineTotal === null || lineTotal <= 0) errors[`${prefix}.lineTotal`]="Enter a positive line total";
      if (lineTotal !== null) {
        const nextSum = addPaise(lineSum, lineTotal);
        if (nextSum === null) errors[`${prefix}.lineTotal`]="Total exceeds the supported range";
        else lineSum = nextSum;
      }
      if (quantity !== null && unitPrice !== null && lineTotal !== null) {
        const expectedLineTotal = calculateLineTotalPaise(quantity, unitPrice);
        if (expectedLineTotal === null) errors[`${prefix}.lineTotal`]="Line amount exceeds the supported range";
        else if (Math.abs(expectedLineTotal - lineTotal) > 100) errors[`${prefix}.lineTotal`]="Quantity × unit price does not match";
      }
    });
    if (total !== null && items.length > 0 && Math.abs(lineSum-total)>100) {
      errors.documentTotal="PO total does not match line totals";
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length) setError("Correct the highlighted fields before submitting.");
    return Object.keys(errors).length === 0;
  }

  function updateItem(index:number,key:keyof DraftItem,value:string|number) {
    setItems(items.map((item,i) => i===index ? {...item,[key]:value} : item));
    clearFieldError(`lineItems.${index}.${key}`);
  }
  async function persistDraft():Promise<boolean> {
    setError("");
    setNotice("");
    if (!header.poNumber.trim() || isTemporaryPoNumber(header.poNumber.trim())) {
      setFieldErrors(current => ({...current,poNumber:"Enter the actual PO number from the document"}));
      setError("Enter the actual PO number from the document before saving.");
      return false;
    }
    try {
      const response=await fetch(`/api/pos/${props.id}`,{
        method:"PATCH", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...header,lineItems:items.map(item=>({...item,quantity:item.quantity.trim()?Number(item.quantity):null}))})
      });
      const data=await response.json();
      if(!response.ok) {
        setError(data.error||"Could not save");
        if (data.duplicate) setFieldErrors({poNumber:data.error});
        return false;
      }
      setNotice(props.status === "REJECTED" ? "Changes saved." : "Draft saved.");
      return true;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    }
  }
  async function save() {
    if (pending) return;
    setPending("save");
    await persistDraft();
    setPending(null);
  }
  async function action(action:"submit"|"approve"|"reject") {
    if (pending) return;
    setError("");
    setNotice("");
    if (action==="submit") {
      if (!validateForSubmit()) return;
    }
    if (action==="reject" && !reason.trim()) {
      setFieldErrors(current => ({...current,reason:"A rejection reason is required"}));
      setError("Enter a rejection reason before rejecting.");
      return;
    }
    setPending(action);
    try {
      if (action==="submit" && !await persistDraft()) return;
      const url = action==="submit" ? `/api/pos/${props.id}/submit` : `/api/pos/${props.id}/decision`;
      const response=await fetch(url,{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify(action==="submit"?{}:{action:action==="approve"?"APPROVE":"REJECT",reason})
      });
      const data=await response.json();
      if(!response.ok) setError(data.error||"Action failed");
      else if (action === "approve" || action === "reject") window.location.href = "/dashboard";
      else window.location.reload();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }
  function addItem(){ setItems([...items,{sku:"",description:"",quantity:"1",unitPrice:"0.00",lineTotal:"0.00"}]); }
  function removeItem(index:number) {
    setItems(items.filter((_,itemIndex)=>itemIndex!==index));
    setFieldErrors(current=>Object.fromEntries(
      Object.entries(current).filter(([key])=>!key.startsWith("lineItems"))
    ));
  }

  const checksPass = items.length > 0 && detailsPass && !lineMathMismatch && !poMismatch;
  const checkTitle = items.length === 0 ? "Add line items" : !detailsPass ? "Complete PO details" : checksPass ? "Checks look good" : "Review needed";
  const checkDescription = checksPass ? "Required details and totals are within ₹1." : "Resolve the flagged items before submission.";

  return (
    <div className="review-layout">
      <section className="card review-details">
        <div className="review-card-heading"><div><span className="section-index">01</span><div><h2>Purchase order details</h2><p>Review the information read from the source document.</p></div></div>{props.editable && <span className="edit-indicator">Editable</span>}</div>
        {props.extractionMethod === "unreadable" && <div className="review-alert warning-alert"><strong>Manual entry needed</strong><span>This PDF could not be read automatically. Enter the details from the original file.</span></div>}
        <div className="details-grid">
          <label>PO number<input value={header.poNumber} placeholder={missingExtractedNumber ? "Enter PO number manually" : undefined} aria-invalid={Boolean(fieldErrors.poNumber)} aria-label="Purchase order number" onChange={e=>{setHeader({...header,poNumber:e.target.value});clearFieldError("poNumber");}} disabled={!props.editable} />{fieldErrors.poNumber&&<span className="field-error">{fieldErrors.poNumber}</span>}</label>
          <label>PO date <span className="label-hint">DD-MM-YYYY</span><input value={header.poDate} placeholder="15-11-2026" aria-invalid={Boolean(fieldErrors.poDate)} aria-label="Purchase order date, day-month-year" onChange={e=>{setHeader({...header,poDate:e.target.value});clearFieldError("poDate");}} disabled={!props.editable} />{fieldErrors.poDate&&<span className="field-error">{fieldErrors.poDate}</span>}</label>
          <label>Vendor<input value={header.vendorName} aria-invalid={Boolean(fieldErrors.vendorName)} aria-label="Vendor name" onChange={e=>{setHeader({...header,vendorName:e.target.value});clearFieldError("vendorName");}} disabled={!props.editable} />{fieldErrors.vendorName&&<span className="field-error">{fieldErrors.vendorName}</span>}</label>
          <label>Printed PO total <span className="label-hint">INR</span><input type="number" step="0.01" value={header.documentTotal} aria-invalid={Boolean(fieldErrors.documentTotal)} aria-label="Printed purchase order total in rupees" onChange={e=>{setHeader({...header,documentTotal:e.target.value});clearFieldError("documentTotal");}} disabled={!props.editable} />{fieldErrors.documentTotal&&<span className="field-error">{fieldErrors.documentTotal}</span>}</label>
        </div>
      </section>

      <aside className="card review-checks">
        <div className="review-card-heading"><div><span className="section-index">02</span><div><h2>Validation</h2><p>Totals and extraction status</p></div></div></div>
        <div className={`check-result ${checksPass ? "check-pass" : "check-attention"}`} role="status" aria-live="polite">
          <span className="check-mark" aria-hidden="true">{checksPass ? "✓" : "!"}</span>
          <div><strong>{checkTitle}</strong><span>{checkDescription}</span></div>
        </div>
        <div className="total-summary">
          <div><span>Printed total</span><strong>{formatPaise(documentTotal)}</strong></div>
          <div><span>Line items total</span><strong>{formatPaise(calculated)}</strong></div>
          <div className={poMismatch ? "total-difference is-error" : "total-difference"}><span>Difference</span><strong>{formatPaise(Math.abs(documentTotal-calculated))}</strong></div>
        </div>
        {lineMathMismatch && <p className="validation-note error">At least one line amount differs from quantity × unit price.</p>}
        {poMismatch && <p className="validation-note error">The line item total does not match the printed PO total.</p>}
        {items.length === 0 && <p className="validation-note warning">Line items not checked.</p>}
        <div className="extraction-meta"><span>Read method</span><span className={`extraction-tag ${props.extractionMethod === "unreadable" ? "tag-manual" : ""}`}>{props.extractionMethod === "text_layer" ? "Text layer" : "Manual entry"}</span></div>
        {visibleExtractionWarnings.length > 0 && <details className="extraction-warnings"><summary>{visibleExtractionWarnings.length} extraction {visibleExtractionWarnings.length === 1 ? "note" : "notes"}</summary><ul>{visibleExtractionWarnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>}
      </aside>

      <section className="card review-lines">
        <div className="review-card-heading lines-heading"><div><span className="section-index">03</span><div><h2>Line items <span className="item-count">{items.length}</span></h2><p>Verify quantities, unit prices and line totals.</p></div></div>
          {props.editable && <button className="secondary add-line-button" type="button" onClick={addItem} disabled={Boolean(pending)}><span aria-hidden="true">＋</span> Add line item</button>}
        </div>
        {fieldErrors.lineItems&&<p className="field-error">{fieldErrors.lineItems}</p>}
        <div className="table-wrap review-table-wrap">
          <table className="review-table">
            <thead><tr><th scope="col">SKU</th><th scope="col">Description</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Line total</th>{props.editable&&<th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>
              {items.map((item,index)=>(
                <tr key={index}>
                  <td><input value={item.sku} aria-label={`SKU for line ${index+1}`} aria-invalid={Boolean(fieldErrors[`lineItems.${index}.sku`])} onChange={e=>updateItem(index,"sku",e.target.value)} disabled={!props.editable} />{fieldErrors[`lineItems.${index}.sku`]&&<span className="field-error">{fieldErrors[`lineItems.${index}.sku`]}</span>}</td>
                  <td><input value={item.description} aria-label={`Description for line ${index+1}`} aria-invalid={Boolean(fieldErrors[`lineItems.${index}.description`])} onChange={e=>updateItem(index,"description",e.target.value)} disabled={!props.editable} />{fieldErrors[`lineItems.${index}.description`]&&<span className="field-error">{fieldErrors[`lineItems.${index}.description`]}</span>}</td>
                  <td><input type="number" min="1" step="1" value={item.quantity} aria-label={`Quantity for line ${index+1}`} aria-invalid={Boolean(fieldErrors[`lineItems.${index}.quantity`])} onChange={e=>updateItem(index,"quantity",e.target.value)} disabled={!props.editable} />{fieldErrors[`lineItems.${index}.quantity`]&&<span className="field-error">{fieldErrors[`lineItems.${index}.quantity`]}</span>}</td>
                  <td><input type="number" min="0.01" step="0.01" value={item.unitPrice} aria-label={`Unit price in rupees for line ${index+1}`} aria-invalid={Boolean(fieldErrors[`lineItems.${index}.unitPrice`])} onChange={e=>updateItem(index,"unitPrice",e.target.value)} disabled={!props.editable} />{fieldErrors[`lineItems.${index}.unitPrice`]&&<span className="field-error">{fieldErrors[`lineItems.${index}.unitPrice`]}</span>}</td>
                  <td><input type="number" min="0.01" step="0.01" value={item.lineTotal} aria-label={`Line total in rupees for line ${index+1}`} aria-invalid={Boolean(fieldErrors[`lineItems.${index}.lineTotal`])||!lineChecks[index]} onChange={e=>updateItem(index,"lineTotal",e.target.value)} disabled={!props.editable} />{fieldErrors[`lineItems.${index}.lineTotal`]&&<span className="field-error">{fieldErrors[`lineItems.${index}.lineTotal`]}</span>}{!lineChecks[index]&&<span className="field-error">Qty × unit price differs.</span>}</td>
                  {props.editable&&<td className="line-action-cell"><button className="text-button" type="button" onClick={()=>removeItem(index)} disabled={Boolean(pending)} aria-label={`Remove line ${index+1}`}>Remove</button></td>}
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={props.editable ? 6 : 5} className="empty-lines">No line items yet. Add at least one item to run the PO checks.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {(error || notice) && <div className={`review-feedback ${error ? "feedback-error" : "feedback-success"}`} role={error ? "alert" : "status"} aria-live="polite">{error || notice}</div>}

      {(props.editable || props.approverCanDecide) && <section className="review-action-panel">
        <div className="action-copy"><strong>{props.editable ? (props.status === "REJECTED" ? "Update and resubmit" : "Ready to submit?") : "Make a decision"}</strong><span>{props.editable ? "Your changes are saved before the PO is sent for approval." : "Review the source PDF and validation details before deciding."}</span></div>
        <div className="review-action-controls">
          {props.editable && <><button onClick={save} type="button" className="secondary" disabled={Boolean(pending)}>{pending==="save"?"Saving…":props.status === "REJECTED" ? "Save changes" : "Save draft"}</button><button onClick={()=>action("submit")} type="button" disabled={Boolean(pending)}>{pending==="submit"?(props.status === "REJECTED" ? "Resubmitting…" : "Submitting…"):(props.status === "REJECTED" ? "Resubmit for approval" : "Submit for approval")}</button></>}
          {props.approverCanDecide && <><label className="rejection-field">Rejection reason<textarea placeholder="Required if you reject this order" aria-invalid={Boolean(fieldErrors.reason)} value={reason} onChange={e=>{setReason(e.target.value);clearFieldError("reason");}} disabled={Boolean(pending)} />{fieldErrors.reason&&<span className="field-error">{fieldErrors.reason}</span>}</label><div className="decision-buttons"><button onClick={()=>action("reject")} type="button" className="danger" disabled={Boolean(pending)}>{pending==="reject"?"Rejecting…":"Reject"}</button><button onClick={()=>action("approve")} type="button" disabled={Boolean(pending)}>{pending==="approve"?"Approving…":"Approve PO"}</button></div></>}
        </div>
      </section>}
    </div>
  );
}
