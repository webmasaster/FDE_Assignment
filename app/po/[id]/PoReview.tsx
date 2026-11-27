"use client";
import { useMemo, useState } from "react";
import { parseDate, parseMoney } from "@/lib/checks";

type LineItem = { sku:string; description:string; quantity:number; unitPricePaise:number; lineTotalPaise:number };
type DraftItem = { sku:string; description:string; quantity:number; unitPrice:string; lineTotal:string };
type Props = {
  id:string;
  poNumber:string;
  poDate:string;
  vendorName:string;
  documentTotalPaise:number;
  extractionMethod:string;
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
  const [header, setHeader] = useState({ poNumber:props.poNumber, poDate:displayDate(props.poDate), vendorName:props.vendorName, documentTotal:(props.documentTotalPaise/100).toFixed(2) });
  const [items, setItems] = useState<DraftItem[]>(props.lineItems.map(item => ({
    sku:item.sku,
    description:item.description,
    quantity:item.quantity,
    unitPrice:(item.unitPricePaise/100).toFixed(2),
    lineTotal:(item.lineTotalPaise/100).toFixed(2)
  })));
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [fieldErrors,setFieldErrors] = useState<Record<string,string>>({});
  const [reason,setReason] = useState("");

  const calculated = useMemo(() => items.reduce((sum,item) => sum + (parseMoney(item.lineTotal) ?? 0),0),[items]);
  const documentTotal = parseMoney(header.documentTotal) ?? 0;
  const lineMathMismatch = items.some(item => {
    const unitPrice = parseMoney(item.unitPrice);
    const lineTotal = parseMoney(item.lineTotal);
    return !Number.isSafeInteger(Number(item.quantity)) ||
      Number(item.quantity) <= 0 ||
      unitPrice === null ||
      unitPrice <= 0 ||
      lineTotal === null ||
      Math.abs(Number(item.quantity) * unitPrice - lineTotal) > 100;
  });
  const poMismatch = items.length > 0 && Math.abs(calculated-documentTotal)>100;

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
    if (!header.poNumber.trim()) errors.poNumber="PO number is required";
    if (!parseDate(header.poDate)) errors.poDate="Enter a valid date (DD-MM-YYYY)";
    if (!header.vendorName.trim()) errors.vendorName="Vendor is required";
    const total = parseMoney(header.documentTotal);
    if (total === null || total <= 0) errors.documentTotal="Enter a positive PO total";
    if (items.length === 0) errors.lineItems="Add at least one line item";

    let lineSum = 0;
    items.forEach((item,index) => {
      const prefix=`lineItems.${index}`;
      const quantity=Number(item.quantity);
      const unitPrice=parseMoney(item.unitPrice);
      const lineTotal=parseMoney(item.lineTotal);
      if (!item.sku.trim()) errors[`${prefix}.sku`]="SKU is required";
      if (!item.description.trim()) errors[`${prefix}.description`]="Description is required";
      if (!Number.isSafeInteger(quantity) || quantity <= 0) errors[`${prefix}.quantity`]="Enter a positive whole number";
      if (unitPrice === null || unitPrice <= 0) errors[`${prefix}.unitPrice`]="Enter a positive unit price";
      if (lineTotal === null || lineTotal <= 0) errors[`${prefix}.lineTotal`]="Enter a positive line total";
      if (lineTotal !== null) lineSum += lineTotal;
      if (Number.isSafeInteger(quantity) && quantity > 0 && unitPrice !== null && lineTotal !== null &&
          Math.abs(quantity * unitPrice - lineTotal) > 100) {
        errors[`${prefix}.lineTotal`]="Quantity × unit price does not match";
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
  async function save():Promise<boolean> {
    setError("");
    setNotice("");
    const response=await fetch(`/api/pos/${props.id}`,{
      method:"PATCH", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({...header,lineItems:items})
    });
    const data=await response.json();
    if(!response.ok) {
      setError(data.error||"Could not save");
      if (data.duplicate) setFieldErrors({poNumber:data.error});
      return false;
    }
    setNotice("Draft saved.");
    return true;
  }
  async function action(action:"submit"|"approve"|"reject") {
    setError("");
    setNotice("");
    if (action==="submit") {
      if (!validateForSubmit()) return;
      if (!await save()) return;
    }
    if (action==="reject" && !reason.trim()) {
      setFieldErrors({reason:"A rejection reason is required"});
      setError("Enter a rejection reason before rejecting.");
      return;
    }
    const url = action==="submit" ? `/api/pos/${props.id}/submit` : `/api/pos/${props.id}/decision`;
    const response=await fetch(url,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify(action==="submit"?{}:{action:action==="approve"?"APPROVE":"REJECT",reason})
    });
    const data=await response.json();
    if(!response.ok) setError(data.error||"Action failed");
    else if (action === "approve" || action === "reject") window.location.href = "/dashboard";
    else window.location.reload();
  }
  function addItem(){ setItems([...items,{sku:"",description:"",quantity:1,unitPrice:"0.00",lineTotal:"0.00"}]); }

  return (
    <div className="grid">
      <div className="card">
        <h2>PO details</h2>
        {props.extractionMethod==="unreadable" && <p className="warning">This PDF could not be read automatically. Enter the details manually.</p>}
        <div className="grid">
          <label>PO number<input value={header.poNumber} aria-invalid={Boolean(fieldErrors.poNumber)} onChange={e=>{setHeader({...header,poNumber:e.target.value});clearFieldError("poNumber");}} disabled={!props.editable} />{fieldErrors.poNumber&&<span className="field-error">{fieldErrors.poNumber}</span>}</label>
          <label>PO date (DD-MM-YYYY)<input value={header.poDate} placeholder="15-11-2026" aria-invalid={Boolean(fieldErrors.poDate)} onChange={e=>{setHeader({...header,poDate:e.target.value});clearFieldError("poDate");}} disabled={!props.editable} />{fieldErrors.poDate&&<span className="field-error">{fieldErrors.poDate}</span>}</label>
          <label>Vendor<input value={header.vendorName} aria-invalid={Boolean(fieldErrors.vendorName)} onChange={e=>{setHeader({...header,vendorName:e.target.value});clearFieldError("vendorName");}} disabled={!props.editable} />{fieldErrors.vendorName&&<span className="field-error">{fieldErrors.vendorName}</span>}</label>
          <label>PO total (₹)<input type="number" step="0.01" value={header.documentTotal} aria-invalid={Boolean(fieldErrors.documentTotal)} onChange={e=>{setHeader({...header,documentTotal:e.target.value});clearFieldError("documentTotal");}} disabled={!props.editable} />{fieldErrors.documentTotal&&<span className="field-error">{fieldErrors.documentTotal}</span>}</label>
        </div>
      </div>
      <div className="card">
        <h2>Checks</h2>
        <p>Extraction: <strong>{props.extractionMethod}</strong></p>
        {items.length===0 ? <p className="warning">Line items not checked</p> : lineMathMismatch ? <p className="error">One or more line items do not add up.</p> : <p className={poMismatch?"error":""}>{poMismatch?"PO total does not match line totals":"PO totals match"}</p>}
        {items.length>0 && <p>Calculated total: ₹{(calculated/100).toLocaleString("en-IN",{minimumFractionDigits:2})}</p>}
      </div>
      <div className="card" style={{gridColumn:"1/-1"}}>
        <h2>Line items</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>SKU</th><th>Description</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead>
            <tbody>
              {items.map((item,index)=>(
                <tr key={index}>
                  <td><input value={item.sku} aria-invalid={Boolean(fieldErrors[`lineItems.${index}.sku`])} onChange={e=>updateItem(index,"sku",e.target.value)} disabled={!props.editable} />{fieldErrors[`lineItems.${index}.sku`]&&<span className="field-error">{fieldErrors[`lineItems.${index}.sku`]}</span>}</td>
                  <td><input value={item.description} aria-invalid={Boolean(fieldErrors[`lineItems.${index}.description`])} onChange={e=>updateItem(index,"description",e.target.value)} disabled={!props.editable} />{fieldErrors[`lineItems.${index}.description`]&&<span className="field-error">{fieldErrors[`lineItems.${index}.description`]}</span>}</td>
                  <td><input type="number" value={item.quantity} aria-invalid={Boolean(fieldErrors[`lineItems.${index}.quantity`])} onChange={e=>updateItem(index,"quantity",Number(e.target.value))} disabled={!props.editable} />{fieldErrors[`lineItems.${index}.quantity`]&&<span className="field-error">{fieldErrors[`lineItems.${index}.quantity`]}</span>}</td>
                  <td><input type="number" step="0.01" value={item.unitPrice} aria-invalid={Boolean(fieldErrors[`lineItems.${index}.unitPrice`])} onChange={e=>updateItem(index,"unitPrice",e.target.value)} disabled={!props.editable} />{fieldErrors[`lineItems.${index}.unitPrice`]&&<span className="field-error">{fieldErrors[`lineItems.${index}.unitPrice`]}</span>}</td>
                  <td><input type="number" step="0.01" value={item.lineTotal} aria-invalid={Boolean(fieldErrors[`lineItems.${index}.lineTotal`])} onChange={e=>updateItem(index,"lineTotal",e.target.value)} disabled={!props.editable} />{fieldErrors[`lineItems.${index}.lineTotal`]&&<span className="field-error">{fieldErrors[`lineItems.${index}.lineTotal`]}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {fieldErrors.lineItems&&<p className="field-error">{fieldErrors.lineItems}</p>}
        {props.editable && <button className="secondary" style={{marginTop:12}} type="button" onClick={addItem}>Add line</button>}
      </div>
      {error && <div className="card error" style={{gridColumn:"1/-1"}}>{error}</div>}
      {notice && <div className="card" style={{gridColumn:"1/-1"}}>{notice}</div>}
      <div className="card actions" style={{gridColumn:"1/-1"}}>
        {props.editable && <><button onClick={save} type="button" className="secondary">Save draft</button><button onClick={()=>action("submit")} type="button">Submit</button></>}
        {props.approverCanDecide && <><button onClick={()=>action("approve")} type="button">Approve</button><button onClick={()=>action("reject")} type="button" className="danger">Reject</button>
          <label style={{minWidth:320}}>Rejection reason<textarea aria-invalid={Boolean(fieldErrors.reason)} value={reason} onChange={e=>{setReason(e.target.value);clearFieldError("reason");}} />{fieldErrors.reason&&<span className="field-error">{fieldErrors.reason}</span>}</label></>}
      </div>
    </div>
  );
}
