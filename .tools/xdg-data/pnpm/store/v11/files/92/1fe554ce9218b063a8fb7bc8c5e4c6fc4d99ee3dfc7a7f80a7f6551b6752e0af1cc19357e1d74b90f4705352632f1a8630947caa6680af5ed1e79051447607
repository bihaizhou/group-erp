/**
 * Information about a linked Git worktree.
 */
export type GitWorktree = {
    /**
     * Basename of the worktree directory.
     */
    name: string;
    /**
     * URL-safe slug generated from the worktree name.
     */
    slug: string;
    /**
     * First twelve characters of the SHA-256 hash for the canonical path.
     */
    hash: string;
    /**
     * Canonical absolute path to the worktree.
     */
    path: string;
};
/**
 * Returns information about the linked Git worktree containing the given
 * directory. Returns null for the main worktree and directories outside a
 * Git repository.
 */
export declare function getGitWorktree(cwd?: string): Promise<GitWorktree | null>;
