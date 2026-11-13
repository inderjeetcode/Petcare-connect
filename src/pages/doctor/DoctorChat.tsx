import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useDoctorWorkspace } from '../../hooks/useDoctorWorkspace';
import { doctorPortalService } from '../../services/doctorPortalService';
import {
  DoctorAttachment,
  DoctorChatConversation,
  DoctorChatMessage,
  DoctorConsultation,
} from '../../types/doctor';
import { validateAttachmentFile } from '../../utils/clientPortalHelpers';
import {
  canDoctorAccessConsultationChat,
  getDoctorChatWindowStatus,
} from '../../utils/doctorPortalHelpers';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { Modal } from '../../components/common/Modal';
import {
  AlertCircle,
  CheckCheck,
  ChevronLeft,
  Clock,
  Download,
  FilePlus,
  Image as ImageIcon,
  Lock,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react';

export const DoctorChat: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useApp();
  const { workspace, doctorBasePath, doctorLoading } = useDoctorWorkspace();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [consultations, setConsultations] = useState<DoctorConsultation[]>([]);

  const [loadingChat, setLoadingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<DoctorChatConversation | null>(null);
  const [messages, setMessages] = useState<DoctorChatMessage[]>([]);

  const [messageInput, setMessageInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [previewDoc, setPreviewDoc] = useState<{
    attachment: DoctorAttachment;
    signedUrl: string;
  } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const loadConsultations = useCallback(async () => {
    if (!workspace || !workspace.doctorProfileId) {
      setConsultations([]);
      setLoadingList(false);
      return;
    }
    setLoadingList(true);
    setListError(null);
    try {
      const list = await doctorPortalService.getConsultations(
        workspace.organizationId,
        workspace.doctorProfileId
      );
      // D-16: Strictly enforce participant-only thread list for the treating doctor
      setConsultations(
        list.filter((c) =>
          canDoctorAccessConsultationChat(
            c,
            workspace.organizationId,
            workspace.doctorProfileId
          )
        )
      );
    } catch (err: any) {
      setListError(err.message || 'Unable to load consultation chats.');
    } finally {
      setLoadingList(false);
    }
  }, [workspace]);

  useEffect(() => {
    void loadConsultations();
  }, [loadConsultations]);

  const activeConsultationId = useMemo(() => {
    if (id && consultations.some((c) => c.id === id)) return id;
    return (
      consultations.find((c) => c.consultation_status === 'active')?.id ||
      consultations[0]?.id
    );
  }, [id, consultations]);

  const currentConsultation = useMemo(
    () => consultations.find((c) => c.id === activeConsultationId) || null,
    [consultations, activeConsultationId]
  );

  const chatWindow = useMemo(
    () =>
      currentConsultation
        ? getDoctorChatWindowStatus(currentConsultation, nowMs)
        : null,
    [currentConsultation, nowMs]
  );

  const loadConversationAndMessages = useCallback(async () => {
    if (!workspace || !currentConsultation) {
      setConversation(null);
      setMessages([]);
      return;
    }
    setLoadingChat(true);
    setChatError(null);
    try {
      const conv = await doctorPortalService.getConversationByConsultation(
        workspace.organizationId,
        currentConsultation.id
      );
      setConversation(conv);
      if (conv) {
        const msgs = await doctorPortalService.getConversationMessages(
          workspace.organizationId,
          conv.id,
          currentConsultation
        );
        setMessages(msgs);
        await doctorPortalService.markConversationRead(conv.id).catch(() => {});
      } else {
        setMessages([]);
      }
    } catch (err: any) {
      setChatError(err.message || 'Unable to load chat messages.');
    } finally {
      setLoadingChat(false);
    }
  }, [workspace, currentConsultation]);

  useEffect(() => {
    void loadConversationAndMessages();
  }, [loadConversationAndMessages]);

  useEffect(() => {
    if (!conversation?.id || !workspace || !currentConsultation) return;
    return doctorPortalService.subscribeToConversationMessages(
      conversation.id,
      () => {
        void doctorPortalService
          .getConversationMessages(
            workspace.organizationId,
            conversation.id,
            currentConsultation
          )
          .then((msgs) => {
            setMessages(msgs);
            void doctorPortalService.markConversationRead(conversation.id).catch(() => {});
          })
          .catch(() => {});
      }
    );
  }, [conversation?.id, workspace, currentConsultation]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, activeConsultationId]);

  const handleSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    const err = validateAttachmentFile(file);
    if (err) {
      showToast(err, 'error');
      return;
    }
    setSelectedFile(file);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace || !currentConsultation || !conversation) return;
    if (!chatWindow?.canSendMessages) {
      showToast('This consultation chat window is read-only.', 'warning');
      return;
    }
    if (!messageInput.trim() && !selectedFile) return;

    setSending(true);
    try {
      await doctorPortalService.sendChatMessage({
        organization_id: workspace.organizationId,
        consultation_id: currentConsultation.id,
        conversation_id: conversation.id,
        content: messageInput,
        file: selectedFile,
      });
      setMessageInput('');
      setSelectedFile(null);
      const refreshed = await doctorPortalService.getConversationMessages(
        workspace.organizationId,
        conversation.id,
        currentConsultation
      );
      setMessages(refreshed);
    } catch (err: any) {
      showToast(err.message || 'Unable to send message.', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleOpenAttachment = async (att: DoctorAttachment) => {
    setOpeningId(att.id);
    try {
      const signedUrl = await doctorPortalService.createSignedAttachmentUrl(
        att.object_path,
        300
      );
      setPreviewDoc({ attachment: att, signedUrl });
    } catch (err: any) {
      showToast(err.message || 'Unable to generate secure attachment link.', 'error');
    } finally {
      setOpeningId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return consultations.filter(
      (c) =>
        !q ||
        (c.pet_name || '').toLowerCase().includes(q) ||
        (c.client_name || '').toLowerCase().includes(q) ||
        c.consultation_reason.toLowerCase().includes(q)
    );
  }, [consultations, search]);

  if (doctorLoading || loadingList) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading participant chat sessions..." />
      </div>
    );
  }

  if (!workspace || !workspace.doctorProfileId) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-xs text-amber-800">
        Your doctor profile record is pending in this clinic workspace. Once provisioned, your participant consultation chats will appear here.
      </div>
    );
  }

  if (listError) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-xs text-rose-800 space-y-3">
        <div className="flex items-center gap-2 font-bold">
          <AlertCircle className="w-4 h-4 text-rose-600" />
          Unable to load chats
        </div>
        <p>{listError}</p>
        <button
          type="button"
          onClick={() => void loadConsultations()}
          className="px-3 py-1.5 bg-rose-700 text-white rounded-lg font-semibold inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-[calc(100vh-8.5rem)] flex flex-col md:flex-row">
      {/* Left Participant Chat Sessions List */}
      <div className="w-full md:w-80 lg:w-96 border-r border-slate-200 flex flex-col bg-slate-50/50 shrink-0 max-h-64 md:max-h-none">
        <div className="p-3.5 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-teal-700" />
              Patient Chats ({consultations.length})
            </h2>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter by patient or owner..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-100 rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No consultation chat sessions assigned to you yet.
            </div>
          ) : (
            filtered.map((c) => {
              const isSelected = c.id === activeConsultationId;
              const win = getDoctorChatWindowStatus(c, nowMs);

              return (
                <div
                  key={c.id}
                  onClick={() => navigate(`${doctorBasePath}/chat/${c.id}`)}
                  className={`p-3.5 cursor-pointer transition-colors flex items-start gap-3 ${
                    isSelected
                      ? 'bg-teal-50/70 border-l-4 border-l-teal-700'
                      : 'hover:bg-slate-100/70'
                  }`}
                >
                  <div className="w-10 h-10 rounded-xl bg-teal-800 text-white flex items-center justify-center font-bold text-xs shrink-0">
                    {(c.pet_name || 'P')[0]}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-slate-900 truncate">
                        {c.pet_name} {c.pet_species ? `(${c.pet_species})` : ''}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {new Date(c.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-600 truncate mt-0.5">
                      Client: {c.client_name}
                    </div>

                    <div className="mt-1.5 flex items-center gap-1.5">
                      {win.isActive && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-800 font-mono">
                          <Clock className="w-2.5 h-2.5 text-teal-700" />
                          {win.formatted}
                        </span>
                      )}
                      {win.isExpired && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-200 text-slate-600">
                          <Lock className="w-2.5 h-2.5" /> Read-only
                        </span>
                      )}
                      {win.isPending && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                          Pending activation
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Chat Box */}
      {currentConsultation && chatWindow ? (
        <div className="flex-1 flex flex-col bg-[#F8FAFC] relative min-w-0">
          {/* Header */}
          <div className="p-3.5 bg-white border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => navigate(`${doctorBasePath}/consultations`)}
                className="md:hidden p-1 text-slate-500"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="w-10 h-10 rounded-full bg-teal-700 text-white flex items-center justify-center font-bold text-sm shrink-0">
                {(currentConsultation.pet_name || 'P')[0]}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 truncate">
                    Patient: {currentConsultation.pet_name}
                  </h3>
                  <StatusBadge status={currentConsultation.consultation_status} />
                </div>
                <div className="text-xs text-slate-500 truncate">
                  Client: {currentConsultation.client_name} · Ref #{currentConsultation.id.slice(0, 8)}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  navigate(`${doctorBasePath}/prescriptions`, {
                    state: {
                      petId: currentConsultation.pet_id,
                      consultationId: currentConsultation.id,
                    },
                  })
                }
                className="px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 border border-teal-200 rounded-lg transition-colors flex items-center gap-1"
              >
                <FilePlus className="w-3.5 h-3.5" />
                Issue Rx
              </button>

              {chatWindow.isActive ? (
                <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-teal-50 border border-teal-200 rounded-lg text-teal-900 font-mono text-xs font-bold">
                  <Clock className="w-3.5 h-3.5 text-teal-700" />
                  {chatWindow.formatted}
                </div>
              ) : (
                <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-slate-100 border border-slate-200 rounded-lg text-slate-600 text-xs font-semibold">
                  <Lock className="w-3.5 h-3.5 text-slate-500" />
                  Read-Only
                </div>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3.5">
            <div className="text-center my-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-slate-200/80 text-slate-600">
                <ShieldCheck className="w-3.5 h-3.5 text-teal-700" />
                Participant-only consultation thread · Restricted to treating doctor and{' '}
                {currentConsultation.client_name}
              </span>
            </div>

            {loadingChat ? (
              <div className="py-12 flex justify-center">
                <LoadingSpinner size="md" label="Loading clinical messages..." />
              </div>
            ) : chatError ? (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                {chatError}
              </div>
            ) : messages.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                {chatWindow.isPending
                  ? 'Chat activates once the consultation is opened from a confirmed appointment.'
                  : 'No messages exchanged yet in this thread.'}
              </div>
            ) : (
              messages.map((msg) => {
                const isDoctor = msg.sender_role === 'doctor';
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isDoctor ? 'items-end' : 'items-start'}`}
                  >
                    <div className="text-[10px] text-slate-400 mb-1 px-1">
                      {msg.sender_name} ({isDoctor ? 'Doctor / You' : 'Client'})
                    </div>

                    <div
                      className={`max-w-md sm:max-w-lg rounded-2xl px-4 py-2.5 text-xs shadow-xs ${
                        isDoctor
                          ? 'bg-teal-700 text-white rounded-br-none'
                          : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none'
                      }`}
                    >
                      {msg.attachments.length > 0 && (
                        <div className="mb-2 space-y-1.5">
                          {msg.attachments.map((att) => (
                            <button
                              key={att.id}
                              type="button"
                              disabled={openingId === att.id}
                              onClick={() => void handleOpenAttachment(att)}
                              className={`w-full text-left px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-2 text-xs ${
                                isDoctor
                                  ? 'bg-teal-800/70 border-teal-500/40 text-white hover:bg-teal-800'
                                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              <span className="flex items-center gap-1.5 truncate">
                                <Paperclip className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{att.original_filename}</span>
                              </span>
                              <Download className="w-3.5 h-3.5 shrink-0" />
                            </button>
                          ))}
                        </div>
                      )}

                      <p className="leading-relaxed whitespace-pre-wrap">
                        {msg.message_content}
                      </p>

                      <div
                        className={`text-[10px] mt-1 flex items-center justify-end gap-1 ${
                          isDoctor ? 'text-teal-200' : 'text-slate-400'
                        }`}
                      >
                        <span>
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {isDoctor && <CheckCheck className="w-3.5 h-3.5 text-teal-300" />}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Composer or Read-Only Lockdown */}
          {!chatWindow.canSendMessages ? (
            <div className="p-4 bg-slate-100 border-t border-slate-300 text-center text-xs font-semibold text-slate-700 flex items-center justify-center gap-2">
              <Lock className="w-4 h-4 text-slate-500 shrink-0" />
              <span>
                {chatWindow.isPending
                  ? 'Consultation is pending activation. Messaging is locked.'
                  : chatWindow.isRejected
                  ? 'Consultation was declined. Messaging is closed.'
                  : 'This 7-day consultation window has ended or completed. Chat history remains archived in read-only mode.'}
              </span>
            </div>
          ) : (
            <form
              onSubmit={handleSendMessage}
              className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
            >
              <input
                ref={fileInputRef}
                type="file"
                id="doctor-chat-file-upload"
                accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                onChange={handleSelectFile}
                className="hidden"
              />
              <label
                htmlFor="doctor-chat-file-upload"
                title="Attach JPEG, PNG, WebP or PDF (max 10 MB)"
                className="p-2 text-slate-500 hover:text-teal-700 hover:bg-slate-100 rounded-xl cursor-pointer transition-colors"
              >
                <Paperclip className="w-5 h-5" />
              </label>

              {selectedFile && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-teal-50 border border-teal-200 text-teal-800 rounded-lg text-xs">
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span className="truncate max-w-[140px]">{selectedFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className="text-slate-400 hover:text-slate-600 ml-1 font-bold"
                  >
                    ×
                  </button>
                </div>
              )}

              <input
                type="text"
                placeholder="Type clinical advice or follow-up questions for the pet owner..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                disabled={sending}
                className="flex-1 px-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
              <button
                type="submit"
                disabled={sending || (!messageInput.trim() && !selectedFile) || !conversation}
                className="p-2.5 bg-teal-700 text-white rounded-xl hover:bg-teal-800 disabled:opacity-40 transition-colors shadow-xs"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs text-slate-500 space-y-2">
          <MessageSquare className="w-8 h-8 text-slate-300" />
          <p className="font-semibold text-slate-700">No consultation selected</p>
          <p>Select a consultation thread or start one from a confirmed appointment.</p>
        </div>
      )}

      {/* Signed URL Preview Modal */}
      <Modal
        isOpen={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc?.attachment.original_filename || 'Attachment'}
        subtitle="Time-limited private storage URL (expires in 5 minutes)"
        maxWidth="2xl"
      >
        {previewDoc && (
          <div className="space-y-4">
            {previewDoc.attachment.mime_type.startsWith('image/') ? (
              <img
                src={previewDoc.signedUrl}
                alt={previewDoc.attachment.original_filename}
                className="max-h-[60vh] w-full object-contain rounded-lg border border-slate-200 bg-slate-50"
              />
            ) : (
              <iframe
                src={previewDoc.signedUrl}
                title={previewDoc.attachment.original_filename}
                className="w-full h-[60vh] rounded-lg border border-slate-200 bg-slate-50"
              />
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
              >
                Close
              </button>
              <a
                href={previewDoc.signedUrl}
                download={previewDoc.attachment.original_filename}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
