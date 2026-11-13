import React from 'react';
import { Prescription } from '../../types';
import { ClientPrescription } from '../../types/client';
import { Modal } from './Modal';
import { Printer, Download, HeartHandshake, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';

type PrintablePrescription = Prescription | ClientPrescription;

interface PrescriptionModalProps {
  prescription: PrintablePrescription | null;
  isOpen: boolean;
  onClose: () => void;
  organizationName?: string;
}

export const PrescriptionModal: React.FC<PrescriptionModalProps> = ({
  prescription,
  isOpen,
  onClose,
  organizationName,
}) => {
  const { showToast } = useApp();

  if (!prescription) return null;

  const isVoid =
    'status' in prescription && prescription.status === 'void';
  const voidReason =
    'void_reason' in prescription ? prescription.void_reason : null;

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    showToast(`Preparing printable PDF for ${prescription.pet_name || 'patient'}...`, 'info');
    setTimeout(() => {
      window.print();
    }, 300);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Veterinary Clinical Prescription"
      subtitle={`Reference ID: ${prescription.id}`}
      maxWidth="2xl"
    >
      <div className="space-y-6">
        {isVoid && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 text-xs text-rose-800 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <strong className="uppercase tracking-wide block">
                Prescription Voided
              </strong>
              <span>
                This prescription has been voided by the veterinary clinic and is no longer valid for dispensing.
                {voidReason ? ` Reason: ${voidReason}` : ''}
              </span>
            </div>
          </div>
        )}

        {/* Printable Prescription Document Area */}
        <div
          id="printable-rx"
          className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 text-slate-800 shadow-xs"
        >
          {/* Header */}
          <div className="border-b-2 border-teal-800 pb-4 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-teal-800 text-white flex items-center justify-center font-bold">
                <HeartHandshake className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold tracking-tight text-teal-900 uppercase">
                  {organizationName || 'Pet Connect Veterinary Health'}
                </h2>
                <p className="text-xs text-slate-500">
                  Digital Veterinary Prescription Record
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-semibold text-slate-900">
                {prescription.doctor_name || 'Veterinary Practitioner'}
              </div>
              {prescription.doctor_qualification && (
                <div className="text-[11px] text-teal-700 font-medium">
                  {prescription.doctor_qualification}
                </div>
              )}
              <div className="text-[10px] text-slate-400">
                Date: {new Date(prescription.created_at).toLocaleDateString()}
              </div>
            </div>
          </div>

          {/* Patient & Owner Info Box */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-lg border border-slate-100 my-4 text-xs">
            <div>
              <span className="text-slate-400 block font-medium">Patient:</span>
              <span className="font-bold text-slate-900">
                {prescription.pet_name || 'Patient'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Species/Breed:</span>
              <span className="font-semibold text-slate-800">
                {prescription.pet_species || '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Pet Owner:</span>
              <span className="font-semibold text-slate-800">
                {prescription.client_name || 'Registered Owner'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Follow-Up Date:</span>
              <span className="font-semibold text-teal-700">
                {prescription.follow_up_date
                  ? new Date(prescription.follow_up_date).toLocaleDateString()
                  : 'As needed'}
              </span>
            </div>
          </div>

          {/* Diagnosis */}
          <div className="my-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Clinical Diagnosis:
            </span>
            <p className="text-sm font-semibold text-slate-900 mt-0.5">
              {prescription.diagnosis}
            </p>
          </div>

          {/* Rx Icon & Medication Table */}
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl font-serif font-black text-teal-800">℞</span>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Prescribed Medications & Posology
              </span>
            </div>

            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100/80 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Medication Name</th>
                    <th className="py-2 px-3">Dosage</th>
                    <th className="py-2 px-3">Frequency</th>
                    <th className="py-2 px-3">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {prescription.items.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-3 text-slate-400">{idx + 1}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900">{item.medicine_name}</div>
                        {item.instructions && (
                          <div className="text-[11px] text-slate-500">{item.instructions}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-800">{item.dosage}</td>
                      <td className="py-2.5 px-3 text-slate-600">{item.frequency}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-700">{item.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Clinical Instructions */}
          {prescription.instructions && (
            <div className="mt-4 bg-teal-50/50 p-3 rounded-lg border border-teal-100">
              <span className="text-xs font-bold text-teal-900 uppercase tracking-wide block">
                Doctor Instructions:
              </span>
              <p className="text-xs text-teal-800 mt-1 leading-relaxed">
                {prescription.instructions}
              </p>
            </div>
          )}

          {/* Digital Signature & Verification Footer */}
          <div className="mt-6 pt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
              <ShieldCheck className="w-4 h-4" />
              <span>
                {isVoid
                  ? 'Voided Clinical Document'
                  : 'Digitally Verified Veterinary Document'}
              </span>
            </div>
            <div className="text-right">
              <div className="font-serif italic text-sm text-slate-800 font-bold">
                {prescription.doctor_name || 'Veterinary Practitioner'}
              </div>
              <div className="text-[10px] text-slate-400">Electronic Clinical Seal</div>
            </div>
          </div>
        </div>

        {/* Modal Action Buttons (Hidden when printed) */}
        <div className="flex items-center justify-end gap-3 no-print">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <Download className="w-4 h-4" />
            Download PDF
          </button>
        </div>
      </div>
    </Modal>
  );
};
