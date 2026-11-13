import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useClientWorkspace } from '../../hooks/useClientWorkspace';
import { clientPortalService } from '../../services/clientPortalService';
import {
  ClientAttachment,
  ClientChatConversation,
  ClientChatMessage,
  ClientConsultation,
} from '../../types/client';
import {
  computeChatWindowStatus,
  validateAttachmentFile,
} from '../../utils/clientPortalHelpers';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { Modal } from '../../components/common/Modal';
import {
  Send,
  Paperclip,
  Clock,
  AlertCircle,
  ShieldCheck,
  Check,
  CheckCheck,
  Search,
  MessageSquare,
  Lock,
  ChevronLeft,
  Image as ImageIcon,
  Download,
  RefreshCw,
} from 'lucide-react';

export const ClientChat: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useApp();
  const { workspace, clientBasePath } = useClientWorkspace();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [consultations, setConsultations] = useState<ClientConsultation[]>([]);

  const [loadingChat, setLoadingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ClientChatConversation | null>(null);
  const [messages, setMessages] = useState<ClientChatMessage[]>([]);

  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [previewDoc, setPreviewDoc] = useState<{
    attachment: ClientAttachment;
    signedUrl: string;
  } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    const timerId = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timerId);
  }, []);

  const loadConsultations = useCallback(async () => {
    if (!workspace) {
      setLoadingList(false);
      return;
    }
    setLoadingList(true);
    setListError(null);
    try {
      await clientPortalService.expireDueConsultations(workspace.organizationId).catch(() => 0);
      const list = await clientPortalService.getConsultations(workspace.organizationId);
      setConsultations(list);
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
    if (id) return id;
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
        ? computeChatWindowStatus(currentConsultation, nowMs)
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
      const conv = await clientPortalService.getConversationByConsultation(
        workspace.organizationId,
        currentConsultation.id
      );
      setConversation(conv);
      if (conv) {
        const msgs = await clientPortalService.getConversationMessages(
          workspace.organizationId,
          conv.id,
          currentConsultation
        );
        setMessages(msgs);
        await clientPortalService.markConversationRead(conv.id).catch(() => {});
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

  // Realtime subscription to chat_messages & consultation status changes
  useEffect(() => {
    if (!conversation?.id || !workspace || !currentConsultation) {
      return;
    }
    const unsubMessages = clientPortalService.subscribeToConversationMessages(
      conversation.id,
      () => {
        void clientPortalService
          .getConversationMessages(
            workspace.organizationId,
            conversation.id,
            currentConsultation
          )
          .then((msgs) => {
            setMessages(msgs);
            void clientPortalService.markConversationRead(conversation.id).catch(() => {});
          })
          .catch(() => {});
      }
    );
    const unsubConsultation = clientPortalService.subscribeToConsultationChanges(
      currentConsultation.id,
      () => {
        void loadConsultations();
      }
    );
    return () => {
      unsubMessages();
      unsubConsultation();
    };
  }, [conversation?.id, workspace, currentConsultation, loadConsultations]);

  // Automatically synchronize DB consultation_status to 'expired' when active window passes expires_at
  useEffect(() => {
    if (
      !workspace ||
      !currentConsultation ||
      currentConsultation.consultation_status !== 'active' ||
      !currentConsultation.expires_at
    ) {
      return;
    }
    const expiresMs = new Date(currentConsultation.expires_at).getTime();
    if (!Number.isNaN(expiresMs) && nowMs >= expiresMs) {
      void clientPortalService
        .expireDueConsultations(workspace.organizationId, currentConsultation.id)
        .then((count) => {
          if (count > 0) void loadConsultations();
        })
        .catch(() => {});
    }
  }, [workspace, currentConsultation, nowMs, loadConsultations]);

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
    if (!currentConsultation || !conversation || !workspace) return;
    if (!chatWindow?.canSendMessages) {
      showToast('This consultation chat window is read-only.', 'warning');
      return;
    }
    if (!messageInput.trim() && !selectedFile) return;

    setSending(true);
    try {
      await clientPortalService.sendChatMessage({
        organization_id: workspace.organizationId,
        consultation_id: currentConsultation.id,
        conversation_id: conversation.id,
        content: messageInput,
        file: selectedFile,
      });
      setMessageInput('');
      setSelectedFile(null);
      const refreshed = await clientPortalService.getConversationMessages(
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

  const handleOpenAttachment = async (att: ClientAttachment) => {
    setOpeningId(att.id);
    try {
      const signedUrl = await clientPortalService.createSignedAttachmentUrl(
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

  const filteredConsultations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return consultations.filter(
      (c) =>
        !q ||
        (c.doctor_name || '').toLowerCase().includes(q) ||
        (c.pet_name || '').toLowerCase().includes(q) ||
        c.consultation_reason.toLowerCase().includes(q)
    );
  }, [consultations, searchQuery]);

  if (!workspace || loadingList) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading consultation chat threads..." />
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
      {/* Left Sidebar: Participant Consultations */}
      <div className="w-full md:w-80 lg:w-96 border-r border-slate-200 flex flex-col bg-slate-50/50 shrink-0 max-h-64 md:max-h-none">
        <div className="p-3.5 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-teal-700" />
              Consultations ({consultations.length})
            </h2>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search doctor, pet, reason..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-100 rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filteredConsultations.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No consultation chat sessions found.
            </div>
          ) : (
            filteredConsultations.map((c) => {
              const isSelected = c.id === activeConsultationId;
              const cWindow = computeChatWindowStatus(c, nowMs);
              return (
                <div
                  key={c.id}
                  onClick={() => navigate(`${clientBasePath}/chat/${c.id}`)}
                  className={`p-3.5 cursor-pointer transition-colors flex items-start gap-3 ${
                    isSelected
                      ? 'bg-teal-50/70 border-l-4 border-l-teal-700'
                      : 'hover:bg-slate-100/70'
                  }`}
                >
                  <div className="w-10 h-10 rounded-xl bg-teal-800 text-white flex items-center justify-center font-bold text-xs shrink-0">
                    {(c.doctor_name || 'Vet').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-slate-900 truncate">
                        {c.doctor_name}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {new Date(c.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                    <div className="text-[11px] font-semibold text-teal-800 truncate">
                      Patient: {c.pet_name} {c.pet_species ? `(${c.pet_species})` : ''}
                    </div>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {c.consultation_reason}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {cWindow.isActive && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-800 font-mono">
                          <Clock className="w-2.5 h-2.5 text-teal-700" />
                          {cWindow.formatted}
                        </span>
                      )}
                      {cWindow.isExpired && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-200 text-slate-600">
                          <Lock className="w-2.5 h-2.5" /> Read-only
                        </span>
                      )}
                      {cWindow.isPending && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                          Pending
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

      {/* Right Chat Panel */}
      {currentConsultation && chatWindow ? (
        <div className="flex-1 flex flex-col bg-[#F7F9FA] relative min-w-0">
          {/* Header */}
          <div className="p-3.5 bg-white border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => navigate(`${clientBasePath}/consultations`)}
                className="md:hidden p-1 text-slate-500"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="w-10 h-10 rounded-full bg-teal-700 text-white flex items-center justify-center font-bold text-sm shrink-0">
                {(currentConsultation.doctor_name || 'DR').slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 truncate">
                    {currentConsultation.doctor_name}
                  </h3>
                  <StatusBadge status={currentConsultation.consultation_status} />
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-1.5 truncate">
                  <span>{currentConsultation.doctor_specialization || 'Veterinarian'}</span>
                  <span>·</span>
                  <span className="text-teal-700 font-semibold">
                    Case: {currentConsultation.pet_name}
                  </span>
                </div>
              </div>
            </div>

            <div className="text-right hidden sm:block shrink-0">
              {chatWindow.isActive ? (
                <div className="bg-teal-50 border border-teal-200 px-3 py-1 rounded-lg">
                  <span className="text-[10px] text-teal-700 font-bold block uppercase tracking-wider">
                    7-Day Chat Window
                  </span>
                  <span className="text-xs font-mono font-bold text-teal-900 flex items-center gap-1 justify-end">
                    <Clock className="w-3.5 h-3.5 text-teal-700" />
                    {chatWindow.formatted}
                  </span>
                </div>
              ) : (
                <div className="bg-slate-100 border border-slate-200 px-3 py-1 rounded-lg text-slate-600">
                  <span className="text-[10px] font-bold block uppercase tracking-wider">
                    {chatWindow.formatted}
                  </span>
                  <span className="text-xs font-medium flex items-center gap-1 justify-end">
                    <Lock className="w-3 h-3 text-slate-500" /> Read-Only
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3.5">
            <div className="text-center my-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-slate-200/80 text-slate-600">
                <ShieldCheck className="w-3.5 h-3.5 text-teal-700" />
                Participant-only clinical thread · Restricted to you and {currentConsultation.doctor_name}
              </span>
            </div>

            {loadingChat ? (
              <div className="py-12 flex justify-center">
                <LoadingSpinner size="md" label="Loading messages..." />
              </div>
            ) : chatError ? (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                {chatError}
              </div>
            ) : messages.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                {chatWindow.isPending
                  ? 'Chat activates once the veterinarian confirms and opens triage.'
                  : 'No messages yet in this consultation thread.'}
              </div>
            ) : (
              messages.map((msg) => {
                const isMe = msg.sender_role === 'client';
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                  >
                    <div className="text-[10px] text-slate-400 mb-1 px-1">
                      {msg.sender_name}
                    </div>
                    <div
                      className={`max-w-md sm:max-w-lg rounded-2xl px-4 py-2.5 text-xs shadow-xs ${
                        isMe
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
                                isMe
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
                          isMe ? 'text-teal-200' : 'text-slate-400'
                        }`}
                      >
                        <span>
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {isMe &&
                          (msg.read_at ? (
                            <span title={`Read at ${new Date(msg.read_at).toLocaleString()}`}>
                              <CheckCheck className="w-3.5 h-3.5 text-teal-200" />
                            </span>
                          ) : (
                            <span title="Sent (unread)">
                              <Check className="w-3.5 h-3.5 text-teal-300/70" />
                            </span>
                          ))}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Composer / Lockdown Banner */}
          {!chatWindow.canSendMessages ? (
            <div className="p-4 bg-slate-100 border-t border-slate-300 text-center space-y-2">
              <div className="max-w-lg mx-auto flex items-center justify-center gap-2 text-xs font-semibold text-slate-700">
                {chatWindow.isPending ? (
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                ) : (
                  <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                )}
                <span>
                  {chatWindow.isPending
                    ? 'Awaiting clinical activation. Messaging becomes available once your 7-day consultation opens.'
                    : chatWindow.isRejected
                    ? 'This consultation request was declined and cannot accept new messages.'
                    : 'This consultation window has ended and is now in read-only mode. Past records and prescriptions remain accessible.'}
                </span>
              </div>
              {chatWindow.isExpired && (
                <button
                  type="button"
                  onClick={() => navigate(`${clientBasePath}/doctors`)}
                  className="px-3.5 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg shadow-xs"
                >
                  Request Follow-up Appointment
                </button>
              )}
            </div>
          ) : (
            <form
              onSubmit={handleSendMessage}
              className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
            >
              <input
                ref={fileInputRef}
                type="file"
                id="chat-file-upload"
                accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                onChange={handleSelectFile}
                className="hidden"
              />
              <label
                htmlFor="chat-file-upload"
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
                placeholder="Type your clinical update or question for the doctor..."
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
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 text-xs space-y-2">
          <MessageSquare className="w-8 h-8 text-slate-300" />
          <p className="font-semibold text-slate-700">No consultation selected</p>
          <p>Choose a consultation on the left or request a new appointment.</p>
        </div>
      )}

      {/* Signed URL Preview Modal */}
      <Modal
        isOpen={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc?.attachment.original_filename || 'Attachment'}
        subtitle="Time-limited signed download URL (expires in 5 minutes)"
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
