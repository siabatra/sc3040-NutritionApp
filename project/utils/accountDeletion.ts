import { collection, deleteDoc, doc, getDocs, limit, query, where, writeBatch, type Query } from 'firebase/firestore';
import { EmailAuthProvider, deleteUser, reauthenticateWithCredential, type User } from 'firebase/auth';
import { db } from '../firebaseConfig';

const BATCH_SIZE = 400;

async function deleteAll(source: Query) {
  while (true) {
    const page = await getDocs(query(source, limit(BATCH_SIZE)));
    if (page.empty) return;
    const batch = writeBatch(db);
    page.docs.forEach((entry) => batch.delete(entry.ref));
    await batch.commit();
  }
}

// The profile goes first so the analytics triggers fired by the later deletes see no
// profile and skip re-marking periods; the backend clears analytics on profile deletion.
export async function deleteUserData(uid: string) {
  await deleteDoc(doc(db, 'users', uid));
  await deleteAll(collection(db, 'users', uid, 'plans'));
  await deleteAll(query(collection(db, 'mealLogs'), where('userId', '==', uid)));
}

export async function deleteAccount(user: User, password: string) {
  if (!user.email) throw new Error('This account has no email address to confirm with.');
  // Re-authenticating up front checks the password before any data is removed and
  // satisfies Firebase's recent-login requirement for deleteUser.
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  await deleteUserData(user.uid);
  await deleteUser(user);
}

export function accountDeletionErrorMessage(error: unknown) {
  switch ((error as { code?: string })?.code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Incorrect password. Please try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
    case 'unavailable':
      return 'Network error. Check your connection and try again.';
    case 'auth/requires-recent-login':
      return 'Please sign out, sign back in, and try again.';
    default:
      return 'Failed to delete your account. Please try again.';
  }
}
