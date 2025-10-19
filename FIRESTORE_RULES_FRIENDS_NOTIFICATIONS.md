# Firestore Rules for Friends + Notifications

Paste the updated rules into your Firestore Security Rules editor to enable friend requests and notifications while keeping strong security constraints.

Notes:
- Notifications are readable only by the recipient (userId == auth.uid).
- Any authenticated user can create a notification addressed to someone else only when they are the sender (fromUserId == auth.uid) and type is friend_request, friend_accept, or activity_invite.
- Only the recipient can delete a notification or mark it as read.
- Profiles remain owner-writable, with narrow, validated exceptions that allow the recipient of a friend request to:
  - Accept: add themselves to the sender's friends and remove themselves from the sender's requestsSent.
  - Decline: remove themselves from the sender's requestsSent.
  - Remove: either party may remove themselves from the other person's friends array (disconnect), ensuring connections are strictly two-way and can be broken by either user.

Replace your existing rules with the following (merge your Activities/Chats blocks if you have custom logic — the blocks below include the ones you shared). This version also enables activity invites (notifications of type activity_invite), and lets the sender retract their own pending activity_invite similar to canceling a friend_request:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }

    // Profiles: signed-in can read; only owner can write, with small controlled exceptions
    match /profiles/{uid} {
      allow read: if isSignedIn();

      // Owner can manage their own document
      allow create, update, delete: if isSignedIn() && request.auth.uid == uid

      // Friend workflow: controlled cross-user updates
      || (
        isSignedIn() && (
          // ACCEPT: current user (the receiver) updates the sender's profile (uid) to:
          // - add themselves to friends
          // - remove themselves from requestsSent
          request.resource.data.diff(resource.data).changedKeys().hasOnly(['friends', 'requestsSent']) &&

          // friends grows by exactly 1 and includes current user
          (('friends' in request.resource.data) &&
            request.resource.data.friends.size() == ((('friends' in resource.data) ? resource.data.friends.size() : 0) + 1) &&
            request.resource.data.friends.hasAll((('friends' in resource.data) ? resource.data.friends : [])) &&
            (request.auth.uid in request.resource.data.friends)
          ) &&

          // requestsSent shrinks by exactly 1 and removes current user
          (('requestsSent' in resource.data) &&
            resource.data.requestsSent.size() == ((('requestsSent' in request.resource.data) ? request.resource.data.requestsSent.size() : 0) + 1) &&
            resource.data.requestsSent.hasAll((('requestsSent' in request.resource.data) ? request.resource.data.requestsSent : [])) &&
            (request.auth.uid in resource.data.requestsSent) &&
            !(request.auth.uid in request.resource.data.requestsSent)
          )
        )
      )

      || (
        isSignedIn() && (
          // DECLINE: only remove current user from sender's requestsSent; friends unchanged
          request.resource.data.diff(resource.data).changedKeys().hasOnly(['requestsSent']) &&
          ('requestsSent' in resource.data) &&
          resource.data.requestsSent.size() == ((('requestsSent' in request.resource.data) ? request.resource.data.requestsSent.size() : 0) + 1) &&
          resource.data.requestsSent.hasAll((('requestsSent' in request.resource.data) ? request.resource.data.requestsSent : [])) &&
          (request.auth.uid in resource.data.requestsSent) &&
          !(request.auth.uid in request.resource.data.requestsSent)
        )
      )

      || (
        isSignedIn() && (
          // REMOVE FRIEND: allow a user to remove themselves from another user's friends list
          request.resource.data.diff(resource.data).changedKeys().hasOnly(['friends']) &&
          ('friends' in resource.data) &&
          // friends shrinks by exactly 1 and removes current user
          resource.data.friends.size() == ((('friends' in request.resource.data) ? request.resource.data.friends.size() : 0) + 1) &&
          resource.data.friends.hasAll((('friends' in request.resource.data) ? request.resource.data.friends : [])) &&
          (request.auth.uid in resource.data.friends) &&
          !(request.auth.uid in request.resource.data.friends)
        )
      );
    }

    // Activities: creator full control; others can only join/leave safely
    match /activities/{activityId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn() && request.resource.data.creatorId == request.auth.uid;
      allow update: if isSignedIn() && (
        resource.data.creatorId == request.auth.uid || (
          request.resource.data.diff(resource.data).changedKeys().hasOnly(['joinedUserIds']) &&
          ('joinedUserIds' in request.resource.data) &&
          (
            // JOIN
            request.resource.data.joinedUserIds.size() == ((('joinedUserIds' in resource.data) ? resource.data.joinedUserIds.size() : 0) + 1) &&
            (('joinedUserIds' in resource.data) ? request.resource.data.joinedUserIds.hasAll(resource.data.joinedUserIds) : true) &&
            (request.auth.uid in request.resource.data.joinedUserIds) &&
            (('maxParticipants' in resource.data) ? (request.resource.data.joinedUserIds.size() <= resource.data.maxParticipants) : true)
          ) || (
            // LEAVE
            ('joinedUserIds' in resource.data) &&
            (request.resource.data.joinedUserIds.size() + 1 == resource.data.joinedUserIds.size()) &&
            resource.data.joinedUserIds.hasAll(request.resource.data.joinedUserIds) &&
            (request.auth.uid in resource.data.joinedUserIds) &&
            !(request.auth.uid in request.resource.data.joinedUserIds)
          )
        )
      );
      // Allow creator to delete; also allow the last remaining participant to delete to ensure cleanup when count reaches 0
      allow delete: if isSignedIn() && (
        resource.data.creatorId == request.auth.uid || (
          ('joinedUserIds' in resource.data) &&
          resource.data.joinedUserIds is list &&
          resource.data.joinedUserIds.size() == 1 &&
          (request.auth.uid in resource.data.joinedUserIds)
        )
      );
    }

    // Helper: safe friend membership checks
    function hasFriend(u1, u2) {
      return (
        get(/databases/$(database)/documents/profiles/$(u1)).data != null &&
        ("friends" in get(/databases/$(database)/documents/profiles/$(u1)).data) &&
        (get(/databases/$(database)/documents/profiles/$(u1)).data.friends is list) &&
        get(/databases/$(database)/documents/profiles/$(u1)).data.friends.hasAny([u2])
      );
    }

    function isMutualFriends(u1, u2) {
      return hasFriend(u1, u2) && hasFriend(u2, u1);
    }

  // Chats: only participants can read; allow self-join from joined activity;
    // allow DM create for mutual friends; allow custom group chats (non-activity) created by a participant
    match /chats/{chatId} {
      allow create: if isSignedIn() && (
        // Group/activity chats: creator or self-joiner from joined activity
        (
          ('activityId' in request.resource.data) &&
          (request.auth.uid in request.resource.data.participants) &&
          (request.auth.uid in get(/databases/$(database)/documents/activities/$(request.resource.data.activityId)).data.joinedUserIds)
        ) ||
        // DMs: exactly two participants who are mutual friends
        (
          ('type' in request.resource.data) && request.resource.data.type == 'dm' &&
          ('participants' in request.resource.data) && request.resource.data.participants is list &&
          request.resource.data.participants.size() == 2 &&
          (request.auth.uid in request.resource.data.participants) &&
          isMutualFriends(request.resource.data.participants[0], request.resource.data.participants[1])
        ) ||
        // Custom GROUP chats (non-activity): creator must be included in participants
        // Note: If you want to restrict members to the creator's friends, enforce it via Cloud Functions
        // or add additional metadata checks. Firestore Rules cannot iterate over a list to verify all members.
        (
          ('type' in request.resource.data) && request.resource.data.type == 'group' &&
          !('activityId' in request.resource.data) &&
          ('participants' in request.resource.data) && request.resource.data.participants is list &&
          (request.auth.uid in request.resource.data.participants) &&
          // Optional basic size constraint
          (request.resource.data.participants.size() >= 2)
        )
      );

      allow read: if isSignedIn() && (request.auth.uid in resource.data.participants);

      // Delete: only allowed when the requester is the sole remaining participant (last person leaving).
      // This guarantees group chats persist until everyone else has left and the final user exits.
      allow delete: if isSignedIn() && (
        (request.auth.uid in resource.data.participants) &&
        (
          ('participants' in resource.data) &&
          resource.data.participants is list &&
          resource.data.participants.size() == 1 &&
          (request.auth.uid in resource.data.participants)
        )
      );

      allow update: if isSignedIn() && (
        // Participants can update their existing chats (e.g., last message metadata). For activity chats, also allow self-join as below.
        (request.auth.uid in resource.data.participants) || (
          // Allow self-join for activity chats only
          ('activityId' in resource.data) &&
          request.resource.data.diff(resource.data).changedKeys().hasOnly(['participants']) &&
          request.resource.data.participants.size() == resource.data.participants.size() + 1 &&
          request.resource.data.participants.hasAll(resource.data.participants) &&
          (request.auth.uid in request.resource.data.participants) &&
          (request.auth.uid in get(/databases/$(database)/documents/activities/$(resource.data.activityId)).data.joinedUserIds)
        )
      );

      match /messages/{messageId} {
        allow read: if isSignedIn() && (request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participants);
        allow create: if isSignedIn()
          && request.auth.uid == request.resource.data.senderId
          && (request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participants);
        allow update, delete: if false;
      }
    }

  // Notifications: recipient can read/delete; creation restricted to sender; sender can delete their own pending friend_request or activity_invite
    match /notifications/{id} {
      // Recipient can read their notifications
      allow read: if isSignedIn() && resource.data.userId == request.auth.uid;

      // Sender creates friend_request, friend_accept, or activity_invite; cannot target self
      allow create: if isSignedIn()
        && request.auth.uid == request.resource.data.fromUserId
        && request.resource.data.userId is string
        && request.resource.data.type in ['friend_request', 'friend_accept', 'activity_invite']
        && request.resource.data.userId != request.auth.uid;

      // Recipient can mark read
      allow update: if isSignedIn()
        && resource.data.userId == request.auth.uid
        && request.resource.data.diff(resource.data).changedKeys().hasOnly(['read'])
        && (resource.data.read == false) && (request.resource.data.read == true);

      // Recipient may delete; additionally allow sender to delete their own pending friend_request (cancel) and activity_invite (retract)
      allow delete: if isSignedIn() && (
        resource.data.userId == request.auth.uid || (
          resource.data.fromUserId == request.auth.uid && resource.data.type in ['friend_request', 'activity_invite']
        )
      );
    }

    // Fallback deny
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

After publishing these rules, try sending a friend request again from another user's profile.
