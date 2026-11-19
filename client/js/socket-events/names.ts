import socket from "../socket";
import {store} from "../store";
import keepUnchangedUsers from "../helpers/keepUnchangedUsers";

socket.on("names", function (data) {
	const netChan = store.getters.findChannel(data.id);

	if (netChan) {
		netChan.channel.users = keepUnchangedUsers(netChan.channel.users, data.users);
	}
});
