// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "@/app/store/i18n";
import { Modal } from "@/app/modals/modal";
import { recordTEvent } from "@/app/store/global";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { GulinUIMessagePart } from "./aitypes";
import { GulinAIModel } from "./gulinai-model";

interface RestoreBackupModalProps {
    part: GulinUIMessagePart & { type: "data-tooluse" };
}

export const RestoreBackupModal = memo(({ part }: RestoreBackupModalProps) => {
    const { t } = useTranslation();
    const model = GulinAIModel.getInstance();
    const toolData = part.data;
    const status = useAtomValue(model.restoreBackupStatus);
    const error = useAtomValue(model.restoreBackupError);

    const formatTimestamp = (ts: number) => {
        if (!ts) return "";
        const date = new Date(ts);
        return date.toLocaleString();
    };

    const handleConfirm = () => {
        recordTEvent("gulinai:revertfile", { "gulinai:action": "revertfile:confirm" });
        model.restoreBackup(toolData.toolcallid, toolData.writebackupfilename, toolData.inputfilename);
    };

    const handleCancel = () => {
        recordTEvent("gulinai:revertfile", { "gulinai:action": "revertfile:cancel" });
        model.closeRestoreBackupModal();
    };

    const handleClose = () => {
        model.closeRestoreBackupModal();
    };

    if (status === "success") {
        return (
            <Modal className="restore-backup-modal pb-5 pr-5" onClose={handleClose} onOk={handleClose} okLabel={t("gulin.ai.restore.close")}>
                <div className="flex flex-col gap-4 pt-4 pb-4 max-w-xl">
                    <div className="font-semibold text-lg text-green-500">{t("gulin.ai.restore.success_title")}</div>
                    <div className="text-sm text-gray-300 leading-relaxed">
                        {t("gulin.ai.restore.success_desc").replace("{filename}", toolData.inputfilename)}
                    </div>
                </div>
            </Modal>
        );
    }

    if (status === "error") {
        return (
            <Modal className="restore-backup-modal pb-5 pr-5" onClose={handleClose} onOk={handleClose} okLabel={t("gulin.ai.restore.close")}>
                <div className="flex flex-col gap-4 pt-4 pb-4 max-w-xl">
                    <div className="font-semibold text-lg text-red-500">{t("gulin.ai.restore.fail_title")}</div>
                    <div className="text-sm text-gray-300 leading-relaxed">
                        {t("gulin.ai.restore.fail_desc")}
                    </div>
                    <div className="text-sm text-red-400 font-mono bg-zinc-800 p-3 rounded break-all">{error}</div>
                </div>
            </Modal>
        );
    }

    const isProcessing = status === "processing";

    return (
        <Modal
            className="restore-backup-modal pb-5 pr-5"
            onClose={handleCancel}
            onCancel={handleCancel}
            onOk={handleConfirm}
            okLabel={isProcessing ? t("gulin.ai.restore.restoring_btn") : t("gulin.ai.restore.confirm_btn")}
            cancelLabel={t("gulin.ai.restore.cancel_btn")}
            okDisabled={isProcessing}
            cancelDisabled={isProcessing}
        >
            <div className="flex flex-col gap-4 pt-4 pb-4 max-w-xl">
                <div className="font-semibold text-lg">{t("gulin.ai.restore.title")}</div>
                <div className="text-sm text-gray-300 leading-relaxed">
                    {t("gulin.ai.restore.desc1").replace("{filename}", toolData.inputfilename)}
                    {toolData.runts && <span> ({formatTimestamp(toolData.runts)})</span>}.
                </div>
                <div className="text-sm text-gray-300 leading-relaxed">
                    {t("gulin.ai.restore.desc2")}
                </div>
            </div>
        </Modal>
    );
});

RestoreBackupModal.displayName = "RestoreBackupModal";